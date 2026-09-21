import type {
  AdjustmentDay,
  AdjustmentFilters,
  AdjustmentMetrics,
  AdjustmentNode,
} from './ad-adjustment.interface';
import type { BiRawRow } from './paid-growth.interface';
import type { MetricStandardProduct, MetricSignal } from './metric-signals';
import { biNumber } from './paid-growth';

export const adjustmentToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
export const adjustmentDates = (today: string) =>
  [2, 1, 0].map((n) =>
    new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10),
  );
const text = (value: unknown) => (value == null ? '' : String(value).trim());
const accountKey = (r: BiRawRow, country = true) =>
  JSON.stringify([
    text(r.app_id),
    text(r.campaign_id),
    ...(country ? [text(r.country_code)] : []),
  ]);
export function adjustmentAccounts(days: AdjustmentDay[]) {
  const map = new Map<string, Set<string>>();
  for (const day of days)
    for (const r of day.accounts.rows) {
      if (!text(r.advertiser_id) || !text(r.campaign_id)) continue;
      for (const key of [accountKey(r), accountKey(r, false)]) {
        const ids = map.get(key) || new Set<string>();
        ids.add(text(r.advertiser_id));
        map.set(key, ids);
      }
    }
  return (r: BiRawRow): string => {
    if (text(r.media_source).toLowerCase() !== 'facebook') return '不适用';
    const ids = map.get(accountKey(r)) || map.get(accountKey(r, false));
    return ids?.size === 1 ? [...ids][0] : ids?.size ? '归属待确认' : '未返回';
  };
}
export function adjustmentMatches(
  r: BiRawRow,
  f: AdjustmentFilters,
  account: string,
): boolean {
  const query = f.search.trim().toLowerCase();
  return (
    (!query ||
      `${text(r.campaign_name)} ${text(r.campaign_id)}`
        .toLowerCase()
        .includes(query)) &&
    (!f.account || account === f.account) &&
    (!f.optimizer || (text(r.buyer_alias) || '未返回') === f.optimizer) &&
    (!f.country || (text(r.country_code) || '未返回') === f.country)
  );
}
export function emptyAdjustmentMetrics(): AdjustmentMetrics {
  return {
    spend: null,
    impressions: null,
    clicks: null,
    installs: null,
    revenue: null,
    cpm: null,
    cpi: null,
    ctr: null,
    cvr: null,
    roas: null,
  };
}
const divide = (a: number | null, b: number | null, scale = 1) =>
  a === null || b === null || b <= 0 ? null : (a / b) * scale;
export function calculateAdjustment(m: AdjustmentMetrics): AdjustmentMetrics {
  return {
    ...m,
    cpm: divide(m.spend, m.impressions, 1000),
    cpi: divide(m.spend, m.installs),
    ctr: divide(m.clicks, m.impressions, 100),
    cvr: divide(m.installs, m.clicks, 100),
    roas: divide(m.revenue, m.spend, 100),
  };
}
const additive = [
  'spend',
  'impressions',
  'clicks',
  'installs',
  'revenue',
] as const;
export function adjustmentTotal(
  values: AdjustmentMetrics[],
): AdjustmentMetrics {
  const total = emptyAdjustmentMetrics();
  for (const k of additive) {
    // Unknown inputs must not silently become zero or a complete total.
    total[k] =
      values.length && values.every((v) => v[k] !== null)
        ? values.reduce((sum, v) => sum + v[k]!, 0)
        : null;
  }
  return calculateAdjustment(total);
}

/** Report overview sums returned source values; individual missing entities remain unknown. */
export function adjustmentReportedTotal(
  values: AdjustmentMetrics[],
): AdjustmentMetrics {
  const total = emptyAdjustmentMetrics();
  for (const k of additive) {
    const known = values
      .map((v) => v[k])
      .filter((v): v is number => v !== null);
    total[k] = known.length ? known.reduce((a, b) => a + b, 0) : null;
  }
  return calculateAdjustment(total);
}

/** Aggregate source facts at each hierarchy, never allocate a campaign's revenue to children. */
export function adjustmentTree(
  days: AdjustmentDay[],
  filters: AdjustmentFilters,
  today: string,
): AdjustmentNode[] {
  const roots = new Map<string, AdjustmentNode>(),
    nodes = new Map<string, AdjustmentNode>();
  const resolveAccount = adjustmentAccounts(days);
  const invalid = new Set<string>();
  for (const day of days)
    for (const [source, part] of [
      ['daily', day.daily],
      ['revenue', day.revenue],
    ] as const) {
      for (const r of part.rows) {
        const account = resolveAccount(r);
        if (
          day.scope &&
          (day.scope.optimizer !== filters.optimizer ||
            day.scope.country !== filters.country)
        )
          continue;
        if (
          !adjustmentMatches(
            r,
            day.scope ? { ...filters, optimizer: '', country: '' } : filters,
            account,
          )
        )
          continue;
        const base = [text(r.app_id), text(r.media_source), account];
        let parent: AdjustmentNode | undefined;
        for (const [level, prefix] of [
          ['campaign', 'campaign'],
          ['adgroup', 'adgroup'],
          ['creative', 'creative'],
        ] as const) {
          if (day.granularity === 'campaign' && level !== 'campaign') break;
          const id = text(r[`${prefix}_id`]);
          const name = text(r[`${prefix}_name`]);
          base.push(id || `name:${name || '未定位'}`);
          const key = JSON.stringify(base);
          let node = nodes.get(key);
          if (!node) {
            node = {
              key,
              id,
              name: name || id || '未定位',
              level,
              account,
              appId: Number(r.app_id),
              appName: text(r.app_name),
              media: text(r.media_source),
              campaignId: text(r.campaign_id),
              adsetId: text(r.adgroup_id),
              days: {},
              children: [],
            };
            nodes.set(key, node);
            if (parent) parent.children.push(node);
            else roots.set(key, node);
          }
          if (day.date === today && name) node.name = name;
          const m = node.days[day.date] || emptyAdjustmentMetrics();
          const values =
            source === 'daily'
              ? {
                  spend: biNumber(r.spend),
                  impressions: biNumber(r.impressions),
                  clicks: biNumber(r.media_clicks),
                  installs: biNumber(r.media_installs),
                }
              : { revenue: biNumber(r.metric_value) };
          for (const field of Object.keys(values) as (keyof typeof values)[]) {
            const badKey = `${key}:${day.date}:${field}`;
            const value = values[field];
            if (value === null || invalid.has(badKey)) {
              m[field] = null;
              invalid.add(badKey);
            } else m[field] = (m[field] ?? 0) + value;
          }
          node.days[day.date] = m;
          parent = node;
        }
      }
    }
  for (const node of nodes.values())
    for (const day of days) {
      const m = node.days[day.date];
      if (!m) continue;
      if (day.daily.state === 'missing')
        for (const k of ['spend', 'impressions', 'clicks', 'installs'] as const)
          m[k] = null;
      if (day.revenue.state === 'missing') m.revenue = null;
      m.stale = [day.daily.state, day.revenue.state].some(
        (s) => s === 'stale' || s === 'missing',
      );
      node.days[day.date] = calculateAdjustment(m);
    }
  const prune = (items: AdjustmentNode[]): AdjustmentNode[] =>
    items
      .filter((n) => n.days[today])
      .map((n) => ({
        ...n,
        children: prune(n.children),
      }))
      .sort(
        (a, b) => (b.days[today].spend ?? -1) - (a.days[today].spend ?? -1),
      );
  return prune([...roots.values()]);
}

export function adjustmentSignal(
  node: AdjustmentNode,
  date: string,
  standards: MetricStandardProduct[],
): MetricSignal {
  if (node.days[date]?.stale)
    return { state: 'unknown', label: '数据过期或不完整，暂不判断达标' };
  const products = standards.filter(
    (p) =>
      p.dorisAppId === node.appId &&
      p.channel.toLowerCase() === node.media.toLowerCase(),
  );
  const metric =
    products.length === 1
      ? products[0].metrics.find((m) => m.key === 'd0_roas')
      : undefined;
  if (!metric || !Number.isFinite(metric.standardValue))
    return { state: 'unknown', label: '未配置 D0 ROAS 标准' };
  const standard =
    metric.standardValue! * (metric.unit === 'percent' ? 100 : 1);
  const value = node.days[date]?.roas;
  if (value == null)
    return { state: 'unknown', label: 'D0 ROAS 未返回或无消耗', standard };
  const good =
    metric.direction === 'lower' ? value <= standard : value >= standard;
  return {
    state: good ? 'good' : 'bad',
    standard,
    label: `${good ? '达标' : '未达标'} · 标准 ${standard}%`,
  };
}

/** Attach lazily loaded children without adding their facts to summary totals. */
export function withAdjustmentDetails(
  roots: AdjustmentNode[],
  details: Record<string, AdjustmentDay[]>,
  filters: AdjustmentFilters,
  today: string,
): AdjustmentNode[] {
  const children = new Map<string, AdjustmentNode[]>();
  for (const days of Object.values(details))
    for (const root of adjustmentTree(days, filters, today))
      children.set(root.key, root.children);
  return roots.map((root) => ({
    ...root,
    children: children.get(root.key) || [],
  }));
}
