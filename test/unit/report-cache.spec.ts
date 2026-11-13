import {
  ReportCacheService,
  reportCycle,
} from '../../server/modules/growth-decision/report-cache.service';
import { RoasReportService } from '../../server/modules/growth-decision/roas-report.service';
import { ReportScheduleService } from '../../server/modules/growth-decision/report-schedule.service';
import { CreativeAnalysisService } from '../../server/modules/growth-decision/creative-analysis.service';
import { personalDataIdentity } from '../../server/common/utils/personal-doris';
jest.mock('../../server/common/utils/personal-doris', () => {
  const actual = jest.requireActual('../../server/common/utils/personal-doris');
  return {
    ...actual,
    configuredDorisUsers: () => ['a'],
    runPersonalData: (_u: string, fn: () => unknown) =>
      actual.personalDataIdentity.run({ username: 'a', revision: 'r1' }, fn),
  };
});
const asUser = <T>(fn: () => T, revision = 'r1') =>
  personalDataIdentity.run({ username: 'a', revision }, fn);
const query = {
  start: '2026-11-13',
  end: '2026-11-13',
  platform: 'android' as const,
};
function setup() {
  const data = new Map<string, string>();
  const db = {
    getBiCache: jest.fn((key: string) => data.get(key)),
    saveBiCache: jest.fn((key: string, value: string) => data.set(key, value)),
  };
  const cache = new ReportCacheService(db as never);
  const bi = {
    part: jest.fn(async (args: Record<string, unknown>) => ({
      state: 'fresh',
      rows:
        args.dataset === 'bi_ads.ads_paid_acquisition_daily'
          ? [
              {
                app_id: 12,
                buyer_alias: 'lzx',
                media_source: 'tiktok',
                report_date: args.start_date,
                media_report_date_timezone: 'Asia/Shanghai',
                spend: 100,
              },
            ]
          : [
              {
                app_id: 12,
                buyer_alias: 'lzx',
                media_source: 'tiktok',
                install_date: args.start_date,
                cohort_index: 0,
                cumulative_metric_value: 20,
                observation_complete: 1,
              },
            ],
    })),
  };
  const roas = new RoasReportService(bi as never, cache);
  return { data, db, cache, bi, roas };
}
describe('daily report persistence and 10:00 schedule', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    jest.setSystemTime(new Date('2026-11-14T01:59:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  it('defines the Shanghai 10:00 boundary', () => {
    expect(reportCycle(new Date('2026-11-14T01:59:59Z'))).toBe('2026-11-13');
    expect(reportCycle(new Date('2026-11-14T02:00:00Z'))).toBe('2026-11-14');
  });
  it('keeps successful slices across elapsed TTLs and service restart, fills only a new date, and isolates revisions', async () => {
    const { roas, bi, cache } = setup();
    await asUser(() => roas.query(query));
    expect(bi.part).toHaveBeenCalledTimes(2);
    jest.setSystemTime(new Date('2026-11-15T04:00:00Z'));
    await asUser(() => new RoasReportService(bi as never, cache).query(query));
    expect(bi.part).toHaveBeenCalledTimes(2);
    await asUser(() => roas.query({ ...query, end: '2026-11-14' }));
    expect(bi.part).toHaveBeenCalledTimes(4);
    await asUser(() => roas.query(query), 'r2');
    expect(bi.part).toHaveBeenCalledTimes(6);
  });
  it('preserves the previous successful snapshot after a failed forced update', async () => {
    const { roas, bi } = setup();
    const before = await asUser(() => roas.query(query));
    bi.part.mockResolvedValue({ state: 'missing', rows: [] } as never);
    const result = await asUser(() => roas.query({ ...query, refresh: true }));
    expect(result.rows).toEqual(before.rows);
    expect(result.issues.join('')).toContain('保留上次成功缓存');
    const calls = bi.part.mock.calls.length;
    await asUser(() => roas.query(query));
    expect(bi.part).toHaveBeenCalledTimes(calls);
  });
  it('refreshes at 10:00 once and does not repeat after scheduler restart', async () => {
    const { roas, bi, cache } = setup();
    await asUser(() => roas.query(query));
    const analysis = { isBusy: () => false };
    const fetcher = { reportBackgroundBusy: () => false };
    const schedule = () =>
      new ReportScheduleService(
        cache,
        analysis as never,
        roas,
        fetcher as never,
      );
    await schedule().tick();
    expect(bi.part).toHaveBeenCalledTimes(2);
    jest.setSystemTime(new Date('2026-11-14T02:00:00Z'));
    await schedule().tick();
    expect(bi.part).toHaveBeenCalledTimes(4);
    await schedule().tick();
    expect(bi.part).toHaveBeenCalledTimes(4);
  });
  it('does not refetch an uncached failed day on every normal query', async () => {
    const { roas, bi } = setup();
    bi.part.mockResolvedValue({ state: 'missing', rows: [] } as never);
    await asUser(() => roas.query(query));
    const calls = bi.part.mock.calls.length;
    const result = await asUser(() => roas.query(query));
    expect(bi.part).toHaveBeenCalledTimes(calls);
    expect(result.issues.join('')).toContain('手动重新抓取');
    await asUser(() => roas.query({ ...query, refresh: true }));
    expect(bi.part.mock.calls.length).toBeGreaterThan(calls);
  });
  it('defers automatic work while foreground queries are busy', async () => {
    const { cache, roas, bi } = setup();
    await asUser(() => roas.query(query));
    jest.setSystemTime(new Date('2026-11-14T02:00:00Z'));
    const schedule = new ReportScheduleService(
      cache,
      { isBusy: () => false } as never,
      roas,
      { reportBackgroundBusy: () => true } as never,
    );
    await schedule.tick();
    expect(bi.part).toHaveBeenCalledTimes(2);
  });
  it('does not retry a failed automatic refresh repeatedly in the same day', async () => {
    const { cache, roas, bi } = setup();
    await asUser(() => roas.query(query));
    bi.part.mockResolvedValue({ state: 'missing', rows: [] } as never);
    jest.setSystemTime(new Date('2026-11-14T02:00:00Z'));
    const schedule = new ReportScheduleService(
      cache,
      { isBusy: () => false } as never,
      roas,
      { reportBackgroundBusy: () => false } as never,
    );
    await schedule.tick();
    const calls = bi.part.mock.calls.length;
    await schedule.tick();
    expect(bi.part).toHaveBeenCalledTimes(calls);
    expect(asUser(() => cache.tasks())[0].error).toBeTruthy();
  });
  it('serves behavior detail caches and queries only the missing day', async () => {
    const { cache, db } = setup();
    const bi = {
      part: jest.fn(async (args: Record<string, unknown>) => ({
        state: 'fresh',
        rows: [],
      })),
    };
    const service = new CreativeAnalysisService(
      bi as never,
      db as never,
      cache,
    );
    let job = asUser(() => service.start({ ...query, behaviorDetail: true }));
    await new Promise<void>((r) => setImmediate(r));
    expect(asUser(() => service.status(job.id)).state).toBe('completed');
    const first = bi.part.mock.calls.length;
    job = asUser(() =>
      new CreativeAnalysisService(bi as never, db as never, cache).start({
        ...query,
        behaviorDetail: true,
      }),
    );
    expect(job.state).toBe('completed');
    expect(bi.part).toHaveBeenCalledTimes(first);
    job = asUser(() =>
      service.start({ ...query, end: '2026-11-14', behaviorDetail: true }),
    );
    await new Promise<void>((r) => setImmediate(r));
    expect(asUser(() => service.status(job.id)).state).toBe('completed');
    expect(
      bi.part.mock.calls
        .slice(first)
        .every(([args]) => args.start_date === '2026-11-14'),
    ).toBe(true);
  });
});
