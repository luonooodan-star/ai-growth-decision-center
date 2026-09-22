import axios from 'axios';
import { BadRequestException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetaAdjustmentService } from '@server/modules/growth-decision/meta-adjustment.service';
import { LocalDatabaseService } from '@server/database/local-database.service';
import type { MetaAdjustmentSnapshot } from '@shared/meta-adjustment';
import * as bridge from '@server/modules/growth-decision/meta-local-bridge';
import { centerIdentity } from '@server/common/utils/center-identity';

const before: MetaAdjustmentSnapshot = {
  id: '111',
  accountId: '222',
  campaignId: '111',
  level: 'campaign',
  name: 'test',
  status: 'ACTIVE',
  effectiveStatus: 'ACTIVE',
  currency: 'USD',
  dailyBudget: '10000',
  budgetEditable: true,
  budgetReason: '',
};
describe('adjustment durable job lifecycle (no Meta network)', () => {
  let root: string, db: LocalDatabaseService, service: MetaAdjustmentService;
  let env: NodeJS.ProcessEnv;
  let applied: number;
  beforeEach(() => {
    jest.spyOn(centerIdentity, 'getStore').mockReturnValue('growth');
    env = { ...process.env };
    root = mkdtempSync(join(tmpdir(), 'adjustment-job-test-'));
    process.env.GROWTH_DATABASE_PATH = join(root, 'db.sqlite');
    process.env.GROWTH_META_WORKSPACE_ORIGIN = 'https://company.test:3001';
    db = new LocalDatabaseService();
    service = new MetaAdjustmentService(db);
    applied = 0;
    jest.spyOn(axios, 'post').mockImplementation(async (_url, data) => {
      const body = data as { action: string };
      if (body.action === 'identity')
        return {
          data: { ownerId: '123' },
          headers: { 'x-growth-identity-version': '2' },
        };
      if (body.action === 'read')
        return {
          data: { snapshot: before },
          headers: { 'x-growth-identity-version': '2' },
        };
      applied++;
      return { data: { after: { ...before, status: 'PAUSED' } } };
    });
  });
  afterEach(() => {
    centerIdentity.disable();
    db.onModuleDestroy();
    rmSync(root, { recursive: true, force: true });
    process.env = env;
    jest.restoreAllMocks();
  });
  const cookie = 'meta_session=test-session; ignored=secret';
  it('exposes safe numeric Meta code and only treats authentication failures as unauthorized', async () => {
    const identity = jest.spyOn(service, 'identity');
    for (const [category, code, status] of [
      ['authentication', 190, 'unauthorized'],
      ['rate_limit', 17, 'unavailable'],
    ] as const) {
      identity.mockRejectedValueOnce(
        new BadRequestException({
          diagnostic: `META_${category.toUpperCase()}`,
          metaFailure: {
            category,
            code,
            subcode: 463,
            message: 'secret upstream details',
          },
        }),
      );
      const result = await service.authorizationStatus(cookie);
      expect(result.status).toBe(status);
      expect(result.reason).toContain(`Meta #${code}/463`);
      expect(JSON.stringify(result)).not.toContain('secret upstream details');
    }
  });
  it('reports a timeout separately without exposing raw upstream errors', async () => {
    jest.spyOn(service, 'identity').mockRejectedValueOnce(
      new BadRequestException({
        diagnostic: 'BRIDGE_TIMEOUT',
        message: 'private upstream detail',
        uncertain: true,
      }),
    );
    const result = await service.authorizationStatus(cookie);
    expect(result).toMatchObject({
      status: 'unavailable',
      diagnostic: 'BRIDGE_TIMEOUT',
    });
    expect(result.reason).toContain('45 秒');
    expect(JSON.stringify(result)).not.toContain('private upstream detail');
    expect(applied).toBe(0);
  });
  it('reports authorization only after identity succeeds; failures do not claim authorization', async () => {
    expect(await service.authorizationStatus(cookie)).toMatchObject({
      status: 'authorized',
      ownerId: '123',
    });
    jest
      .spyOn(service, 'identity')
      .mockRejectedValueOnce(new Error('network unavailable'));
    expect(await service.authorizationStatus(cookie)).toMatchObject({
      status: 'unavailable',
    });
    expect(await service.authorizationStatus('')).toMatchObject({
      status: 'unauthorized',
    });
    expect(applied).toBe(0);
  });
  test('same Meta identity cannot submit another center user preview', async () => {
    const job = await service.preview(cookie, [{ before, status: 'PAUSED' }]);
    expect(job.centerUsername).toBe('growth');
    jest.mocked(centerIdentity.getStore).mockReturnValue('fjx');
    expect(await service.list(cookie)).toEqual([]);
    await expect(service.submit(cookie, job.id)).rejects.toThrow('当前用户');
    expect(applied).toBe(0);
  });
  test('old shared bridge is rejected before preview/mutation', async () => {
    jest.spyOn(bridge, 'readMetaLocalBridge').mockReturnValue({
      origin: 'http://127.0.0.1:18761',
      secret: 'a'.repeat(64),
    });
    jest.mocked(axios.post).mockResolvedValue({ data: { ownerId: '123' } });
    await expect(
      service.preview(cookie, [{ before, status: 'PAUSED' }]),
    ).rejects.toThrow('尚未升级');
    expect(db.listAdjustmentJobs()).toEqual([]);
  });
  test('account name lookup is bounded, deduplicated and read-only', async () => {
    jest.mocked(axios.post).mockResolvedValue({
      data: { accounts: [{ id: '222', name: 'Test account' }] },
    });
    expect(await service.accountNames(cookie, ['222', '222'])).toEqual({
      accounts: [{ id: '222', name: 'Test account' }],
    });
    expect(jest.mocked(axios.post).mock.calls[0][1]).toEqual({
      action: 'account-names',
      accountIds: ['222'],
    });
    await expect(service.accountNames(cookie, ['invalid'])).rejects.toThrow(
      'ID 无效',
    );
    await expect(
      service.accountNames(cookie, Array(11).fill('222')),
    ).rejects.toThrow('ID 无效');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(db.listAdjustmentJobs()).toHaveLength(0);
  });
  test('local bridge uses private auth without browser cookie and rechecks identity', async () => {
    jest.spyOn(bridge, 'readMetaLocalBridge').mockReturnValue({
      origin: 'http://127.0.0.1:18761',
      secret: 'a'.repeat(64),
    });
    const job = await service.preview('', [{ before, status: 'PAUSED' }]);
    expect(job.ownerId).toBe('123');
    expect(applied).toBe(0);
    const options = jest.mocked(axios.post).mock.calls[0][2];
    expect(options?.headers?.Cookie).toBeUndefined();
    expect(options?.headers?.Authorization).toBe(`Bearer ${'a'.repeat(64)}`);
    expect(options?.proxy).toBe(false);
    jest.mocked(axios.post).mockClear();
    await service.identity('');
    await service.identity('');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(db.listAdjustmentJobs())).not.toContain(
      'a'.repeat(64),
    );
  });
  test('campaign ownership uses the current personal identity without cookie fallback', async () => {
    const local = jest
      .spyOn(bridge, 'readMetaLocalBridge')
      .mockReturnValue(undefined);
    await expect(service.campaignAccounts(['111'])).rejects.toThrow(
      '个人 Meta',
    );
    expect(axios.post).not.toHaveBeenCalled();
    local.mockReturnValue({
      origin: 'http://127.0.0.1:18761',
      secret: 'a'.repeat(64),
    });
    jest.mocked(centerIdentity.getStore).mockReturnValue('fjx');
    jest.mocked(axios.post).mockResolvedValueOnce({
      data: {
        ownerId: 'fjx-owner',
        campaigns: [{ campaignId: '111', accountId: '222' }],
        unavailable: [],
      },
      headers: { 'x-growth-identity-version': '2' },
    });
    expect((await service.campaignAccounts(['111'])).ownerId).toBe('fjx-owner');
    const request = jest.mocked(axios.post).mock.calls[0];
    expect(request[1]).toEqual({
      action: 'campaign-accounts',
      campaignIds: ['111'],
    });
    expect(request[2]?.headers?.['X-Growth-User']).toBe('fjx');
    expect(request[2]?.headers?.Cookie).toBeUndefined();
    expect(db.listAdjustmentJobs()).toEqual([]);
  });
  test('preview never writes Meta; explicit submit is idempotent and audited', async () => {
    const preview = await service.preview(cookie, [
      { before, status: 'PAUSED' },
    ]);
    expect(applied).toBe(0);
    await service.submit(cookie, preview.id);
    await new Promise((resolve) => setImmediate(resolve));
    await service.submit(cookie, preview.id);
    expect(applied).toBe(1);
    const saved = db.listAdjustmentJobs()[0];
    expect(saved.state).toBe('completed');
    expect(saved.items[0].after?.status).toBe('PAUSED');
    expect(saved.items[0].evidence?.capturedAt).toBeDefined();
    expect(saved.items[0].evidence?.baseline).toBeUndefined();
    expect(saved.items[0].evidence?.note).toContain('没有唯一匹配');
    expect(JSON.stringify(saved)).not.toContain('test-session');
  });
  test('rejects no-session and duplicate targets before execution', async () => {
    await expect(
      service.preview('', [{ before, status: 'PAUSED' }]),
    ).rejects.toThrow();
    await expect(
      service.preview(cookie, [
        { before, status: 'PAUSED' },
        { before, dailyBudget: '10' },
      ]),
    ).rejects.toThrow('重复');
    expect(applied).toBe(0);
  });
  test('restart marks inflight job uncertain, never resends', async () => {
    const preview = await service.preview(cookie, [
      { before, status: 'PAUSED' },
    ]);
    preview.state = 'running';
    preview.items[0].state = 'running';
    db.saveAdjustmentJob(preview);
    service = new MetaAdjustmentService(db);
    const recovered = db.listAdjustmentJobs()[0];
    expect(recovered.state).toBe('interrupted');
    expect(recovered.items[0].state).toBe('uncertain');
    await service.submit(cookie, recovered.id);
    expect(applied).toBe(0);
  });
  test('ambiguous mutation stops subsequent items and does not retry', async () => {
    jest.mocked(axios.post).mockImplementation(async (_url, data) => {
      const body = data as { action: string; target?: MetaAdjustmentSnapshot };
      if (body.action === 'identity') return { data: { ownerId: '123' } };
      if (body.action === 'read') return { data: { snapshot: body.target } };
      applied++;
      throw new axios.AxiosError('timeout', 'ETIMEDOUT');
    });
    const preview = await service.preview(cookie, [
      { before, status: 'PAUSED' },
      { before: { ...before, id: '555', campaignId: '555' }, status: 'PAUSED' },
    ]);
    await service.submit(cookie, preview.id);
    await new Promise((resolve) => setImmediate(resolve));
    const result = db.listAdjustmentJobs()[0];
    expect(result.items.map((item) => item.state)).toEqual([
      'uncertain',
      'failed',
    ]);
    expect(applied).toBe(1);
  });
  test('expired confirmation cannot execute', async () => {
    const preview = await service.preview(cookie, [
      { before, status: 'PAUSED' },
    ]);
    preview.createdAt = new Date(Date.now() - 11 * 60000).toISOString();
    db.saveAdjustmentJob(preview);
    await expect(service.submit(cookie, preview.id)).rejects.toThrow('过期');
    expect(applied).toBe(0);
  });
});
