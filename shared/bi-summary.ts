import { biNumber, biRows } from './paid-growth';
import type { BiDay, BiPart } from './paid-growth.interface';

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

/** Keep Doris media_source values separate; an incomplete day cannot become zero spend. */
export function biChannelSpend(days: BiDay[], channel: string): number | null {
  if (
    !days.length ||
    days.some((day) => !['fresh', 'cached'].includes(day.daily.state))
  )
    return null;
  let total = 0;
  for (const day of days)
    for (const row of day.daily.rows) {
      if (
        String(row.media_source || '').toLowerCase() !== channel.toLowerCase()
      )
        continue;
      const spend = biNumber(row.spend);
      if (spend === null) return null;
      total += spend;
    }
  return total;
}

/** A complete source with no rows for this channel means zero; failures stay unknown. */
export function biPartChannelSpend(
  part: BiPart | undefined,
  channel: string,
): number | null {
  if (!part || !['fresh', 'cached'].includes(part.state)) return null;
  let total = 0;
  for (const row of part.rows) {
    if (String(row.media_source || '').toLowerCase() !== channel.toLowerCase())
      continue;
    const spend = biNumber(row.spend);
    if (spend === null) return null;
    total += spend;
  }
  return total;
}

export function trendTickIndexes(length: number): number[] {
  if (length < 2) return length ? [0] : [];
  const ticks = Math.min(8, length);
  return Array.from({ length: ticks }, (_, i) =>
    Math.round((i * (length - 1)) / (ticks - 1)),
  );
}
