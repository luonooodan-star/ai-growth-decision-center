import {
  CreativeAnalysisService,
  validateCreativeAnalysisQuery,
} from '../../server/modules/growth-decision/creative-analysis.service';
import { PaidGrowthService } from '../../server/modules/growth-decision/paid-growth.service';
import { LocalDatabaseService } from '../../server/database/local-database.service';
import { personalDataIdentity } from '../../server/common/utils/personal-doris';
import type { CreativeAnalysisQuery } from '@shared/creative-analysis.interface';
import type { BiPart } from '@shared/paid-growth.interface';

const q: CreativeAnalysisQuery = {
  start: '2026-09-25',
  end: '2026-09-25',
  platform: 'android',
};
const asUser = <T>(name: string, action: () => T, revision = 'r1') =>
  personalDataIdentity.run({ username: name, revision }, action);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const first = (id: number) => ({
  event_date: q.start,
  app_id: 12,
  resolved_user_id: String(id),
  geo_country: 'US',
  event_count: 1,
});
function setup() {
  const cache = new Map<string, string>();
  const db = {
    getBiCache: jest.fn((key: string) => cache.get(key)),
    saveBiCache: jest.fn((key: string, data: string) => cache.set(key, data)),
  };
  const bi = {
    part: jest
      .fn<Promise<BiPart>, [Record<string, unknown>, boolean, number, string]>()
      .mockResolvedValue({ state: 'fresh', rows: [] }),
  };
  const service = new CreativeAnalysisService(
    bi as unknown as PaidGrowthService,
    db as unknown as LocalDatabaseService,
  );
  return { service, bi, db, cache };
}
describe('creative analysis jobs', () => {
  it('loads iOS orders and long-lookback attribution with platform isolation and v2 cache keys', async () => {
    const { service, bi, db } = setup();
    bi.part.mockImplementation(async (args) => {
      const filters = JSON.parse(String(args.filters_json));
      if (filters.event_name === 'first_open')
        return { state: 'fresh', rows: [{ ...first(1), app_id: 3 }] };
      return { state: 'fresh', rows: [] };
    });
    const job = asUser('ios', () => service.start({ ...q, platform: 'ios' }));
    await tick();
    const result = asUser('ios', () => service.status(job.id));
    expect(result.state).toBe('completed');
    expect(result.report?.schemaVersion).toBe(2);
    expect(result.report?.rows[0].orders).toBe(0);
    const orderArgs = bi.part.mock.calls.find(
      ([args]) => args.dataset === 'xy_online_data.tbl_user_order',
    )![0];
    expect(JSON.parse(String(orderArgs.filters_json))).toMatchObject({
      platform: 2,
      env: 'Production',
      action_desc: 'PURCHASED',
    });
    const attrArgs = bi.part.mock.calls.find(
      ([args]) =>
        args.dataset === 'xy_online_data.tbl_user_access_permissions_all',
    )![0];
    expect(attrArgs.start_date).toBe('2026-06-28');
    expect(JSON.parse(String(attrArgs.filters_json))).toMatchObject({
      platform: 2,
      user_id: ['1'],
    });
    expect(db.saveBiCache.mock.calls[0][0]).toContain('creative-funnel:v2:');
  });
  it('validates date bounds and fixed product contracts', () => {
    expect(() => validateCreativeAnalysisQuery(q)).not.toThrow();
    for (const invalid of [
      { ...q, start: '2026-02-30' },
      { ...q, start: '2026-01-01' },
      { ...q, end: '2099-01-01' },
      { ...q, platform: 'arbitrary' },
      { ...q, refresh: 'true' },
    ])
      expect(() =>
        validateCreativeAnalysisQuery(invalid as CreativeAnalysisQuery),
      ).toThrow();
  });
  it('merges duplicate tasks and restricts status, cache and jobs to personal credential scope', async () => {
    const { service, bi, db } = setup();
    let resolve!: (part: BiPart) => void;
    bi.part.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const a = asUser('a', () => service.start(q));
    expect(asUser('a', () => service.start(q)).id).toBe(a.id);
    expect(() => asUser('b', () => service.status(a.id))).toThrow();
    expect(() => asUser('a', () => service.status(a.id), 'r2')).toThrow();
    expect(() =>
      asUser('a', () => service.start({ ...q, platform: 'ios' })),
    ).toThrow();
    resolve({ state: 'fresh', rows: [] });
    await tick();
    expect(asUser('a', () => service.status(a.id)).state).toBe('completed');
    const cached = asUser('a', () => service.start(q));
    expect(cached.report?.cache).toBe(true);
    expect(bi.part).toHaveBeenCalledTimes(1);
    expect(db.saveBiCache.mock.calls[0][0]).toContain('a:r1:');
    expect(JSON.parse(db.saveBiCache.mock.calls[0][1]).updatedAt).toBeDefined();
    asUser('b', () => service.start(q));
    await tick();
    expect(bi.part).toHaveBeenCalledTimes(2);
  });
  it('limits global active jobs to two and cancels without launching follow-up queries', async () => {
    const { service, bi } = setup();
    const pending: ((part: BiPart) => void)[] = [];
    bi.part.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const a = asUser('a', () => service.start(q));
    asUser('b', () => service.start(q));
    expect(() => asUser('c', () => service.start(q))).toThrow('两个分析任务');
    asUser('a', () => service.cancel(a.id));
    pending.forEach((resolve) => resolve({ state: 'fresh', rows: [first(1)] }));
    await tick();
    expect(asUser('a', () => service.status(a.id)).state).toBe('cancelled');
    // The remaining call is b's order read; cancelled a does not query orders/events.
    expect(bi.part).toHaveBeenCalledTimes(3);
    asUser('b', () => service.cancel(asUser('b', () => service.start(q)).id));
    pending.at(-1)!({ state: 'fresh', rows: [] });
    await tick();
  });
  it('checks source scope and does not publish truncated/stale first-open data', async () => {
    const { service, bi, db } = setup();
    bi.part.mockResolvedValueOnce({
      state: 'stale',
      rows: [first(1)],
      message: '完整性校验失败',
    });
    const job = service.start(q);
    await tick();
    expect(service.status(job.id)).toMatchObject({
      state: 'failed',
      error: '完整性校验失败',
    });
    expect(db.saveBiCache).not.toHaveBeenCalled();
    bi.part.mockResolvedValueOnce({
      state: 'fresh',
      rows: [{ ...first(1), app_id: 3 }],
    });
    const wrong = service.start(q);
    await tick();
    expect(service.status(wrong.id).error).toContain('产品');
  });
  it('stops repeated failed-source batches, returns explicit missing values and does not cache partial results', async () => {
    const { service, bi, db } = setup();
    bi.part.mockImplementation(async (args) => {
      const filters = JSON.parse(String(args.filters_json));
      if (filters.event_name === 'first_open')
        return {
          state: 'fresh',
          rows: Array.from({ length: 401 }, (_, i) => first(i + 1)),
        };
      if (args.dataset === 'bi_dwd.dwd_app_event')
        return { state: 'missing', rows: [], message: '权限不足' };
      return { state: 'fresh', rows: [] };
    });
    const job = service.start(q);
    await tick();
    const result = service.status(job.id);
    expect(result.state).toBe('completed');
    expect(result.report?.rows[0].chat).toBeNull();
    expect(result.report?.rows[0].users).toBe(401);
    expect(result.report?.issues).toEqual([
      'Android · 2026-09-25 行为事件：权限不足',
    ]);
    expect(
      bi.part.mock.calls.filter(
        ([args]) => args.dataset === 'bi_dwd.dwd_app_event',
      ),
    ).toHaveLength(2);
    expect(db.saveBiCache).not.toHaveBeenCalled();
  });
});
