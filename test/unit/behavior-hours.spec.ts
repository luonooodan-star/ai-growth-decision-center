import {
  shanghaiEventHour,
  buildBehaviorHourlyRows,
} from '../../server/modules/growth-decision/behavior-hours';
import {
  buildCreativeFunnelRows,
  type FunnelCohortUser,
} from '../../server/modules/growth-decision/creative-funnel';
import { mergeBehaviorCounts } from '../../shared/behavior-table';
const cohort: FunnelCohortUser[] = [
  {
    appId: 12,
    platform: 'android',
    bundle: 'com.pixelfly.mellow',
    userId: 'a',
    date: '2026-11-11',
    country: 'US',
  },
  {
    appId: 12,
    platform: 'android',
    bundle: 'com.pixelfly.mellow',
    userId: 'b',
    date: '2026-11-11',
    country: 'US',
  },
];
const event = (user: string, time: string, count: number) => ({
  app_id: 12,
  resolved_user_id: user,
  event_date: '2026-11-11',
  event_name: 'chat_page_send_message_success',
  event_timestamp: Date.parse(time),
  event_count: count,
  character_id: 'x',
});
describe('D0 behavior daily and hourly counts', () => {
  it('converts explicit instants to Shanghai and rejects naive or mismatched dates', () => {
    expect(
      shanghaiEventHour(Date.parse('2026-11-10T16:00:00Z'), '2026-11-11'),
    ).toBe(0);
    expect(
      shanghaiEventHour(
        Date.parse('2026-11-11T15:59:59Z') / 1000,
        '2026-11-11',
      ),
    ).toBe(23);
    expect(() =>
      shanghaiEventHour('2026-11-11 09:00:00', '2026-11-11'),
    ).toThrow();
    expect(() =>
      shanghaiEventHour(Date.parse('2026-11-11T16:00:00Z'), '2026-11-11'),
    ).toThrow();
  });
  it('deduplicates users independently of event counts and preserves cross-hour users', () => {
    const events = [
      event('a', '2026-11-11T01:00:00Z', 3),
      event('a', '2026-11-11T01:30:00Z', 2),
      event('a', '2026-11-11T02:00:00Z', 1),
    ];
    const daily = buildCreativeFunnelRows(cohort, {
      events,
      attribution: [],
      orders: null,
    });
    expect(mergeBehaviorCounts(daily)?.chat_page_send_message_success).toEqual({
      users: 1,
      events: 6,
    });
    const hours = buildBehaviorHourlyRows(cohort, events, []);
    expect(hours).toHaveLength(24);
    expect(
      hours.find((r) => r.hour === 9)?.behaviors
        ?.chat_page_send_message_success,
    ).toEqual({ users: 1, events: 5 });
    expect(
      hours.find((r) => r.hour === 10)?.behaviors
        ?.chat_page_send_message_success?.users,
    ).toBe(1);
    expect(hours.find((r) => r.hour === 8)?.behaviors).toEqual({});
    expect(hours.every((r) => r.users === 2)).toBe(true);
    expect(() => buildBehaviorHourlyRows(cohort, null, [])).toThrow();
    expect(mergeBehaviorCounts([{ behaviors: undefined }])).toBeNull();
  });
});
