import {
  campaignMediaById,
  classifiedMediaPart,
  isFacebookMedia,
} from './paid-media-channel';
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
  coverage?: { date: string; platform: 'android' | 'ios'; complete: boolean }[];
}
export function buildRoasReport(
  dailyRows: BiRawRow[],
  cohortRows: BiRawRow[],
): RoasRow[] {
  const campaignChannels = campaignMediaById(dailyRows);
  const daily = classifiedMediaPart(
    { rows: dailyRows, state: 'fresh' },
    '',
    campaignChannels,
  ).rows;
  const cohort = classifiedMediaPart(
    { rows: cohortRows, state: 'fresh' },
    '',
    campaignChannels,
  ).rows;
  const groups = new Map<string, RoasRow>();
  const keyOf = (
    r: BiRawRow,
    date: string,
    channel = String(r.media_source || '未知'),
  ) =>
    JSON.stringify([
      Number(r.app_id),
      String(r.buyer_alias || '未分配'),
      channel,
      date,
    ]);
  const facebookSpend = new Map<string, number>();
  const makeRow = (r: BiRawRow, date: string): RoasRow => ({
    appId: Number(r.app_id),
    buyer: String(r.buyer_alias || '未分配'),
    channel: String(r.media_source || '未知'),
    date,
    spend: 0,
    days: Array.from({ length: 15 }, () => null),
  });
  const facebookKey = (r: BiRawRow, date: string) => keyOf(r, date, 'facebook');
  for (const r of daily) {
    const date = String(r.report_date).slice(0, 10),
      key = keyOf(r, date);
    const entry = groups.get(key) || makeRow(r, date);
    const spend = Number(r.spend || 0);
    entry.spend += spend;
    if (isFacebookMedia(entry.channel)) {
      const combined = facebookKey(r, date);
      facebookSpend.set(combined, (facebookSpend.get(combined) || 0) + spend);
    }
    groups.set(key, entry);
  }
  for (const r of cohort) {
    const date = String(r.install_date).slice(0, 10);
    const key = keyOf(r, date);
    const entry =
      groups.get(key) ||
      (isFacebookMedia(String(r.media_source)) &&
      (facebookSpend.get(facebookKey(r, date)) || 0) > 0
        ? makeRow(r, date)
        : undefined);
    const i = Number(r.cohort_index);
    if (
      !entry ||
      !Number.isInteger(i) ||
      i < 0 ||
      i > 14 ||
      r.cumulative_metric_value == null
    )
      continue;
    groups.set(key, entry);
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
    .filter(
      (r) =>
        r.spend > 0 ||
        (isFacebookMedia(r.channel) &&
          (facebookSpend.get(
            facebookKey({ app_id: r.appId, buyer_alias: r.buyer }, r.date),
          ) || 0) > 0 &&
          (r.spend !== 0 || r.days.some((day) => day !== null))),
    )
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.buyer.localeCompare(b.buyer),
    );
}
