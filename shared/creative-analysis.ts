import {
  FUNNEL_METRICS,
  type CreativeFunnelRow,
  type FunnelCounts,
} from './creative-analysis.interface';
import { isMetaAttribution } from './creative-tags';

export function sumFunnel(rows: FunnelCounts[]): FunnelCounts {
  const result: FunnelCounts = {
    users: 0,
    chat: 0,
    chat5: 0,
    chat20: 0,
    payShow: 0,
    payClick: 0,
    paySuccess: 0,
    successAny: 0,
    orders: 0,
  };
  for (const row of rows) {
    result.users += row.users;
    for (const metric of FUNNEL_METRICS)
      result[metric] =
        result[metric] === null || row[metric] === null
          ? null
          : result[metric]! + row[metric]!;
  }
  return result;
}
export const funnelRate = (
  n: number | null,
  d: number | null,
): number | null => (n === null || d === null || d <= 0 ? null : (100 * n) / d);
export function matchFunnelRows(
  rows: CreativeFunnelRow[],
  scope: {
    country?: string;
    source?: 'all' | 'meta';
    platform?: string;
    tags?: string[];
  },
) {
  return rows.filter(
    (row) =>
      (!scope.country || row.country === scope.country) &&
      (!scope.platform ||
        scope.platform === 'all' ||
        row.platform === scope.platform) &&
      (scope.source !== 'meta' ||
        (row.attribution === 'matched' && isMetaAttribution(row.channel))) &&
      (scope.tags || []).every(
        (tag) => row.tags.version === 'v2' && row.tags.codes.includes(tag),
      ),
  );
}
export function nextCreativeTags(
  rows: CreativeFunnelRow[],
  selected: string[],
) {
  const matched = matchFunnelRows(rows, { tags: selected });
  const candidates = new Map<string, CreativeFunnelRow[]>();
  for (const row of matched) {
    if (row.tags.version !== 'v2') continue;
    for (const tag of new Set(row.tags.codes)) {
      if (selected.includes(tag)) continue;
      const group = candidates.get(tag) || [];
      group.push(row);
      candidates.set(tag, group);
    }
  }
  return [...candidates]
    .map(([tag, group]) => ({ tag, ...sumFunnel(group) }))
    .sort((a, b) => b.users - a.users || a.tag.localeCompare(b.tag));
}
export function groupCreativeFunnel(
  rows: CreativeFunnelRow[],
  dimension: 'date' | 'country' | 'creativeName',
) {
  const groups = new Map<string, CreativeFunnelRow[]>();
  for (const row of rows) {
    const label = row[dimension] || '未关联素材';
    const key = JSON.stringify([row.platform, label]);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups]
    .map(([key, group]) => ({
      key,
      label: group[0][dimension] || '未关联素材',
      platform: group[0].platform,
      ...sumFunnel(group),
    }))
    .sort((a, b) => b.users - a.users);
}
