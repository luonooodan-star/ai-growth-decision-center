import { biRows } from './paid-growth';
import type { BiDay } from './paid-growth.interface';

/** Ratios of additive totals, never averages of product/campaign percentages. */
export function biSummary(days: BiDay[]) {
  const rows = biRows(days);
  const sum = (field: 'spend' | 'installs' | 'revenue' | 'events') =>
    !rows.length || rows.some((r) => r[field] === null)
      ? null
      : rows.reduce((n, r) => n + r[field]!, 0);
  const spend = sum('spend'),
    revenue = sum('revenue'),
    events = sum('events');
  return {
    spend,
    revenue,
    events,
    installs: sum('installs'),
    d0Roas:
      spend !== null && spend > 0 && revenue !== null
        ? (revenue / spend) * 100
        : null,
    eventCost:
      spend !== null && events !== null && events > 0 ? spend / events : null,
  };
}

export function trendTickIndexes(length: number): number[] {
  if (length < 2) return length ? [0] : [];
  const ticks = Math.min(8, length);
  return Array.from({ length: ticks }, (_, i) =>
    Math.round((i * (length - 1)) / (ticks - 1)),
  );
}
