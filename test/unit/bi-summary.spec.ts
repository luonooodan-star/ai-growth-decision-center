import {
  biChannelSpend,
  biPartChannelSpend,
  biSummary,
  trendTickIndexes,
} from '@shared/bi-summary';
import type { BiDay } from '@shared/paid-growth.interface';
const day = (spend: number, revenue: number): BiDay => ({
  date: '2026-09-21',
  level: 'overall',
  daily: {
    state: 'fresh',
    rows: [{ app_id: 1, media_source: 'facebook', spend, adjust_installs: 10 }],
  },
  revenue: {
    state: 'fresh',
    rows: [{ app_id: 1, media_source: 'facebook', metric_value: revenue }],
  },
  events: {
    state: 'fresh',
    rows: [{ app_id: 1, media_source: 'facebook', metric_value: 5 }],
  },
});
test('D0 overview is revenue divided by spend, not average percentages', () => {
  expect(biSummary([day(10, 20), day(90, 45)]).d0Roas).toBe(65);
  expect(biSummary([day(0, 20)]).d0Roas).toBeNull();
  expect(biSummary([]).d0Roas).toBeNull();
});
test('missing data remains a chart gap; real zero revenue stays zero', () => {
  const d = day(10, 0);
  expect(biSummary([d]).d0Roas).toBe(0);
  d.revenue = { state: 'missing', rows: [] };
  expect(biSummary([d]).d0Roas).toBeNull();
});
test('Facebook and Facebook Web spend remain separate across days', () => {
  const first = day(10, 0);
  first.daily.rows.push({ app_id: 1, media_source: 'facebook_web', spend: 7 });
  const second = day(20, 0);
  second.date = '2026-09-22';
  second.daily.rows.push({ app_id: 1, media_source: 'facebook_web', spend: 3 });
  expect(biChannelSpend([first, second], 'facebook')).toBe(30);
  expect(biChannelSpend([first, second], 'facebook_web')).toBe(10);
  expect(biSummary([first, second]).spend).toBe(40);
  second.daily.state = 'missing';
  expect(biChannelSpend([first, second], 'facebook_web')).toBeNull();
});
test('adjustment channel spend uses complete daily rows and never treats stale as zero', () => {
  const daily = {
    state: 'cached' as const,
    rows: [
      { media_source: 'facebook', spend: 10 },
      { media_source: 'facebook_web', spend: 7 },
    ],
  };
  expect(biPartChannelSpend(daily, 'facebook')).toBe(10);
  expect(biPartChannelSpend(daily, 'facebook_web')).toBe(7);
  expect(biPartChannelSpend(daily, 'other')).toBe(0);
  expect(
    biPartChannelSpend({ ...daily, state: 'stale' }, 'facebook'),
  ).toBeNull();
});
test('ported trend ticks retain first/last and avoid crowding', () => {
  expect(trendTickIndexes(1)).toEqual([0]);
  const ticks = trendTickIndexes(31);
  expect(ticks).toHaveLength(8);
  expect(ticks.at(-1)).toBe(30);
});
