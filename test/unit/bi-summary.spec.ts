import { biSummary, trendTickIndexes } from '@shared/bi-summary';
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
test('ported trend ticks retain first/last and avoid crowding', () => {
  expect(trendTickIndexes(1)).toEqual([0]);
  const ticks = trendTickIndexes(31);
  expect(ticks).toHaveLength(8);
  expect(ticks.at(-1)).toBe(30);
});
