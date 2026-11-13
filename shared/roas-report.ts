import type { BiRawRow } from './paid-growth.interface';
export interface RoasRow {
  appId: number;
  buyer: string;
  channel: string;
  date: string;
  spend: number;
  days: (null | { revenue: number; complete: boolean; declining: boolean })[];
}
export interface RoasReport {
  rows: RoasRow[];
  generatedAt: string;
  issues: string[];
}
export function buildRoasReport(
  daily: BiRawRow[],
  cohort: BiRawRow[],
): RoasRow[] {
  const groups = new Map<string, RoasRow>();
  const keyOf = (r: BiRawRow, date: string) =>
    JSON.stringify([
      Number(r.app_id),
      String(r.buyer_alias || '未分配'),
      String(r.media_source || '未知'),
      date,
    ]);
  for (const r of daily) {
    const date = String(r.report_date).slice(0, 10),
      key = keyOf(r, date);
    const entry = groups.get(key) || {
      appId: Number(r.app_id),
      buyer: String(r.buyer_alias || '未分配'),
      channel: String(r.media_source || '未知'),
      date,
      spend: 0,
      days: Array.from({ length: 15 }, () => null),
    };
    entry.spend += Number(r.spend || 0);
    groups.set(key, entry);
  }
  for (const r of cohort) {
    const entry = groups.get(keyOf(r, String(r.install_date).slice(0, 10)));
    const i = Number(r.cohort_index);
    if (
      !entry ||
      !Number.isInteger(i) ||
      i < 0 ||
      i > 14 ||
      r.cumulative_metric_value == null
    )
      continue;
    const current = entry.days[i];
    entry.days[i] = {
      revenue: (current?.revenue || 0) + Number(r.cumulative_metric_value),
      complete:
        (current?.complete ?? true) &&
        [true, 1, '1', 'true'].includes(r.observation_complete as never),
      declining: false,
    };
  }
  for (const entry of groups.values())
    for (let i = 1; i < 15; i++) {
      const before = entry.days[i - 1],
        current = entry.days[i];
      if (before && current)
        current.declining = current.revenue < before.revenue;
    }
  return [...groups.values()]
    .filter((r) => r.spend > 0)
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.buyer.localeCompare(b.buyer),
    );
}
