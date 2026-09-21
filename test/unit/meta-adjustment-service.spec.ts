import axios from 'axios';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetaAdjustmentService } from '@server/modules/growth-decision/meta-adjustment.service';
import { LocalDatabaseService } from '@server/database/local-database.service';
import type { MetaAdjustmentSnapshot } from '@shared/meta-adjustment';
import * as bridge from '@server/modules/growth-decision/meta-local-bridge';

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
    env = { ...process.env };
    root = mkdtempSync(join(tmpdir(), 'adjustment-job-test-'));
    process.env.GROWTH_DATABASE_PATH = join(root, 'db.sqlite');
    process.env.GROWTH_META_WORKSPACE_ORIGIN = 'https://company.test:3001';
    db = new LocalDatabaseService();
    service = new MetaAdjustmentService(db);
    applied = 0;
    jest.spyOn(axios, 'post').mockImplementation(async (_url, data) => {
      const body = data as { action: string };
      if (body.action === 'identity') return { data: { ownerId: '123' } };
      if (body.action === 'read') return { data: { snapshot: before } };
      applied++;
      return { data: { after: { ...before, status: 'PAUSED' } } };
    });
  });
  afterEach(() => {
    db.onModuleDestroy();
    rmSync(root, { recursive: true, force: true });
    process.env = env;
    jest.restoreAllMocks();
  });
  const cookie = 'meta_session=test-session; ignored=secret';
  test('local bridge uses private auth without browser cookie and rechecks identity', async () => {
    jest
      .spyOn(bridge, 'readMetaLocalBridge')
      .mockReturnValue({
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
