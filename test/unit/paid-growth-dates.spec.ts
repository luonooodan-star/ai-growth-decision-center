import { format } from 'date-fns';
import {
  paidGrowthQuickRange,
  shanghaiCalendarToday,
} from '@shared/paid-growth-dates';

const labels = (range: { from: Date; to: Date }) => [
  format(range.from, 'yyyy-MM-dd'),
  format(range.to, 'yyyy-MM-dd'),
];

test('Shanghai date drives the quick ranges across the UTC day boundary', () => {
  const today = shanghaiCalendarToday(new Date('2026-09-29T16:30:00Z'));
  expect(format(today, 'yyyy-MM-dd')).toBe('2026-09-30');
  expect(labels(paidGrowthQuickRange('today', today))).toEqual([
    '2026-09-30',
    '2026-09-30',
  ]);
  expect(labels(paidGrowthQuickRange('yesterday', today))).toEqual([
    '2026-09-29',
    '2026-09-29',
  ]);
  expect(labels(paidGrowthQuickRange('thisWeek', today))).toEqual([
    '2026-09-28',
    '2026-09-30',
  ]);
  expect(labels(paidGrowthQuickRange('lastWeek', today))).toEqual([
    '2026-09-21',
    '2026-09-27',
  ]);
});
