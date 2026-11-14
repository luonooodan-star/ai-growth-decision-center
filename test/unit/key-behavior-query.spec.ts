import {
  CreativeAnalysisService,
  validateCreativeAnalysisQuery,
} from '../../server/modules/growth-decision/creative-analysis.service';
import { ReportCacheService } from '../../server/modules/growth-decision/report-cache.service';
import {
  keyBehaviorEventNames,
  BEHAVIOR_ORDER,
} from '../../shared/behavior-table';
import { personalDataIdentity } from '../../server/common/utils/personal-doris';
import {
  buildCreativeFunnelRows,
  type FunnelCohortUser,
} from '../../server/modules/growth-decision/creative-funnel';
const q = {
  start: '2026-11-11',
  end: '2026-11-11',
  platform: 'android' as const,
  behaviorDetail: true,
};
const asUser = <T>(fn: () => T) =>
  personalDataIdentity.run({ username: 'test', revision: 'r1' }, fn);
const tick = () => new Promise<void>((r) => setImmediate(r));
function setup() {
  const store = new Map<string, string>();
  const db = {
    getBiCache: (key: string) => store.get(key),
    saveBiCache: (key: string, v: string) => store.set(key, v),
  };
  const cache = new ReportCacheService(db as never);
  const bi = {
    part: jest.fn(async (args: Record<string, unknown>) => {
      const f = JSON.parse(String(args.filters_json || '{}'));
      if (f.event_name === 'first_open')
        return {
          state: 'fresh',
          rows: [
            {
              event_date: q.start,
              app_id: 12,
              resolved_user_id: 'u',
              event_count: 1,
            },
          ],
        };
      if (args.dataset === 'bi_dwd.dwd_app_event')
        return {
          state: 'fresh',
          rows: [
            {
              event_date: q.start,
              app_id: 12,
              resolved_user_id: 'u',
              event_name: (f.event_name as string[])[0],
              event_timestamp: Date.parse('2026-11-11T00:00:00Z'),
              event_count: 3,
            },
          ],
        };
      return { state: 'fresh', rows: [] };
    }),
  };
  return {
    cache,
    bi,
    service: new CreativeAnalysisService(bi as never, db as never, cache),
  };
}
describe('key behavior whitelist and event-specific drilldown', () => {
  it('requests only the confirmed key events for the daily report', async () => {
    const { service, bi } = setup();
    const job = asUser(() => service.start(q));
    await tick();
    expect(asUser(() => service.status(job.id)).state).toBe('completed');
    const detail = bi.part.mock.calls.find(
      ([a]) => JSON.parse(String(a.filters_json)).resolved_user_id,
    )!;
    expect(JSON.parse(String(detail[0].filters_json)).event_name).toEqual(
      keyBehaviorEventNames(),
    );
    expect(detail[0].dimensions).not.toContain('character_id');
    expect(detail[0].dimensions).not.toContain('event_timestamp');
    expect(BEHAVIOR_ORDER).toHaveLength(12);
    expect(keyBehaviorEventNames()).not.toContain('sub_success');
    expect(
      asUser(() => service.status(job.id)).report?.issues.join(''),
    ).toContain('源埋点名尚未确认');
  });
  it('isolates hourly requests and persistent caches by the selected event', async () => {
    const { service, bi, cache } = setup();
    let job = asUser(() =>
      service.start({ ...q, hourly: true, behaviorEvent: 'sub_show' }),
    );
    await tick();
    expect(asUser(() => service.status(job.id)).state).toBe('completed');
    const first = bi.part.mock.calls.length;
    expect(
      asUser(() =>
        service.start({ ...q, hourly: true, behaviorEvent: 'sub_show' }),
      ).state,
    ).toBe('completed');
    expect(bi.part).toHaveBeenCalledTimes(first);
    job = asUser(() =>
      service.start({ ...q, hourly: true, behaviorEvent: 'app_remove' }),
    );
    await tick();
    expect(asUser(() => service.status(job.id)).state).toBe('completed');
    const filters = bi.part.mock.calls
      .filter(([a]) => (a.dimensions as string[]).includes('event_timestamp'))
      .map(([a]) => JSON.parse(String(a.filters_json)).event_name);
    expect(filters).toEqual([['sub_show'], ['app_remove']]);
    expect(asUser(() => cache.tasks()).map((t) => t.event)).toEqual([
      'sub_show',
      'app_remove',
    ]);
  });
  it('reuses an old daily snapshot by projecting only key behaviors without Doris calls', () => {
    const data = new Map<string, string>();
    data.set(
      'test:r1:daily-report-slice:v1:["behavior","2026-11-11","android",false]',
      JSON.stringify({
        updatedAt: '2026-11-11T10:00:00Z',
        data: {
          rows: [
            {
              behaviors: {
                first_open: { users: 2, events: 2 },
                unwanted: { users: 2, events: 500 },
              },
            },
          ],
        },
      }),
    );
    const db = {
      getBiCache: (key: string) => data.get(key),
      saveBiCache: (key: string, value: string) => data.set(key, value),
    };
    const cache = new ReportCacheService(db as never);
    const snapshot = asUser(() =>
      cache.read<{ rows: { behaviors: unknown }[] }>({
        kind: 'behavior',
        date: q.start,
        platform: 'android',
        hourly: false,
        version: 2,
      }),
    );
    expect(snapshot?.data.rows[0].behaviors).toEqual({
      first_open: { users: 2, events: 2 },
    });
    expect(snapshot?.updatedAt).toBe('2026-11-11T10:00:00Z');
  });
  it('uses the confirmed historical milestone event names for event-specific drilldown', async () => {
    expect(keyBehaviorEventNames('message_10_milestone')).toEqual([
      'message_10',
    ]);
    expect(keyBehaviorEventNames('message_20_milestone')).toEqual([
      'message_20',
    ]);
    expect(keyBehaviorEventNames('message_30_milestone')).toEqual([]);
    expect(keyBehaviorEventNames()).not.toContain('message_30');
    expect(BEHAVIOR_ORDER).not.toContain('message_5_milestone');
    const { service, bi } = setup();
    const job = asUser(() =>
      service.start({
        ...q,
        hourly: true,
        behaviorEvent: 'message_10_milestone',
      }),
    );
    await tick();
    const result = asUser(() => service.status(job.id));
    expect(result.state).toBe('completed');
    expect(
      result.report?.rows.find((r) => r.hour === 8)?.behaviors
        ?.message_10_milestone,
    ).toEqual({ users: 1, events: 3 });
    const detail = bi.part.mock.calls.find(([a]) =>
      (a.dimensions as string[]).includes('event_timestamp'),
    );
    expect(JSON.parse(String(detail?.[0].filters_json)).event_name).toEqual([
      'message_10',
    ]);
  });
  it('rejects arbitrary event filters and unsupported mappings before querying', () => {
    for (const behaviorEvent of [undefined, 'other_event', 'initial_setup'])
      expect(() =>
        validateCreativeAnalysisQuery({ ...q, hourly: true, behaviorEvent }),
      ).toThrow();
    expect(() =>
      validateCreativeAnalysisQuery({ ...q, behaviorEvent: 'sub_show' }),
    ).toThrow();
  });
  it('merges confirmed source aliases per user without double-counting users', () => {
    const cohort: FunnelCohortUser[] = [
      {
        date: q.start,
        appId: 12,
        platform: 'android',
        userId: 'u',
        bundle: 'com.pixelfly.mellow',
        country: 'US',
      },
    ];
    const events = ['event_a', 'event_b', 'unwanted'].map((event_name) => ({
      event_name,
      event_date: q.start,
      app_id: 12,
      resolved_user_id: 'u',
      event_count: 2,
    }));
    const rows = buildCreativeFunnelRows(cohort, {
      events,
      attribution: [],
      orders: null,
      behaviorEvents: { stage: ['event_a', 'event_b'] },
    });
    expect(rows[0].behaviors).toEqual({ stage: { users: 1, events: 4 } });
  });
});
