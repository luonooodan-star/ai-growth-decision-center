import type { BiDay, BiLevel, BiRawRow, BiRow } from './paid-growth.interface';

export const BI_DIMENSIONS: Record<BiLevel, string[]> = {
  products: [],
  channels: [],
  overall: [],
  campaigns: ['campaign_id', 'campaign_name'],
  adgroups: ['campaign_id', 'campaign_name', 'adgroup_id', 'adgroup_name'],
  creatives: ['campaign_id', 'campaign_name', 'creative_id', 'creative_name'],
  countries: ['country_code'],
  designers: ['producer_alias'],
  optimizers: ['buyer_alias'],
};
export const biNumber = (value: unknown): number | null =>
  value === null ||
  value === undefined ||
  value === '' ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);
const ratio = (
  a: number | null,
  b: number | null,
  multiplier = 1,
): number | null =>
  a === null || b === null || b <= 0 ? null : (a / b) * multiplier;
const identity = (row: BiRawRow, level: BiLevel): string =>
  JSON.stringify([
    ...(level === 'channels' ? [] : [String(row.app_id ?? '')]),
    ...(level === 'products' ? [] : [String(row.media_source ?? '')]),
    ...BI_DIMENSIONS[level]
      .filter((k) => !k.endsWith('_name'))
      .map((k) => row[k] ?? null),
    // An absent ID must not merge different named entities.
    ...BI_DIMENSIONS[level]
      .filter((k) => k.endsWith('_name') && !row[k.replace('_name', '_id')])
      .map((k) => row[k] ?? null),
  ]);
const groupedIdentity = (row: BiRawRow, levels: BiLevel[]): string =>
  JSON.stringify(
    levels.flatMap((level) =>
      level === 'products'
        ? [row.app_id ?? null]
        : level === 'channels'
          ? [row.media_source ?? null]
          : BI_DIMENSIONS[level]
              .filter(
                (key) =>
                  !key.endsWith('_name') || !row[key.replace('_name', '_id')],
              )
              .map((key) => row[key] ?? null),
    ),
  );
const groupedLabel = (raw: BiRawRow, levels: BiLevel[]): string =>
  levels
    .map((level) =>
      String(
        (level === 'products' && raw.app_name) ||
          (level === 'channels' && raw.media_source) ||
          (level === 'campaigns' && raw.campaign_name) ||
          (level === 'adgroups' && raw.adgroup_name) ||
          (level === 'creatives' && raw.creative_name) ||
          (level === 'countries' && raw.country_code) ||
          (level === 'designers' && raw.producer_alias) ||
          (level === 'optimizers' && raw.buyer_alias) ||
          '未命名',
      ),
    )
    .join(' / ');
const fields = [
  'spend',
  'impressions',
  'clicks',
  'installs',
  'mediaInstalls',
  'revenue',
  'events',
] as const;

function aggregateRates(
  days: BiDay[],
  partKey: 'conversion' | 'payments',
  keyOf: (day: BiDay, row: BiRawRow) => string,
  numerator: string,
  denominator: string,
) {
  const totals = new Map<
    string,
    { numerator: number | null; denominator: number | null }
  >();
  if (
    days.some(
      (day) =>
        !day[partKey] ||
        !['fresh', 'cached', 'stale'].includes(day[partKey]!.state),
    )
  )
    return () => null;
  const add = (total: number | null, value: unknown) => {
    const count = biNumber(value);
    return total === null || count === null || count < 0 ? null : total + count;
  };
  for (const day of days)
    for (const row of day[partKey]!.rows) {
      const key = keyOf(day, row);
      const total = totals.get(key) ?? { numerator: 0, denominator: 0 };
      total.numerator = add(total.numerator, row[numerator]);
      total.denominator = add(total.denominator, row[denominator]);
      totals.set(key, total);
    }
  return (key: string) => {
    const total = totals.get(key);
    return total ? ratio(total.numerator, total.denominator, 100) : null;
  };
}

/** Strict, weighted aggregation. Missing values stay unknown; never average ratios. */
export function biRows(days: BiDay[]): BiRow[] {
  const result = new Map<string, BiRow>();
  const rowKey = (day: BiDay, raw: BiRawRow) =>
    day.levels ? groupedIdentity(raw, day.levels) : identity(raw, day.level);
  const cvr = aggregateRates(
    days,
    'conversion',
    rowKey,
    'media_installs',
    'media_clicks',
  );
  const paymentRate = aggregateRates(
    days,
    'payments',
    (_day, raw) => String(raw.app_id),
    'paying_users',
    'new_users',
  );
  for (const day of days) {
    const joined = new Map<string, Partial<BiRow> & { raw: BiRawRow }>();
    for (const [part, field] of [
      [day.daily, 'daily'],
      [day.revenue, 'revenue'],
      [day.events, 'events'],
    ] as const) {
      for (const raw of part.rows) {
        const key = rowKey(day, raw);
        const item = joined.get(key) || { raw };
        if (field === 'daily') {
          const values = {
            spend: biNumber(raw.spend),
            impressions: biNumber(raw.impressions),
            clicks: biNumber(raw.media_clicks),
            installs: biNumber(raw.adjust_installs),
            mediaInstalls: biNumber(raw.media_installs),
          };
          for (const key of Object.keys(values) as (keyof typeof values)[])
            item[key] =
              item[key] === undefined
                ? values[key]
                : item[key] === null || values[key] === null
                  ? null
                  : item[key]! + values[key]!;
        } else {
          const value = biNumber(raw.metric_value);
          item[field] =
            item[field] === undefined
              ? value
              : item[field] === null || value === null
                ? null
                : item[field]! + value;
        }
        joined.set(key, item);
      }
    }
    for (const [key, item] of joined) {
      const raw = item.raw;
      const row = result.get(key) || {
        key,
        appId: day.levels
          ? day.levels.includes('products') ||
            day.levels.some((level) =>
              ['campaigns', 'adgroups', 'creatives'].includes(level),
            )
            ? Number(day.scopeAppId || raw.app_id)
            : 0
          : day.level === 'channels' && !day.scopeAppId
            ? 0
            : Number(day.scopeAppId || raw.app_id),
        appName: day.levels
          ? day.levels.includes('products') ||
            day.levels.some((level) =>
              ['campaigns', 'adgroups', 'creatives'].includes(level),
            )
            ? String(raw.app_name || '未命名产品')
            : '全部产品'
          : day.level === 'channels' && !day.scopeAppId
            ? '全部产品'
            : String(raw.app_name || '未命名产品'),
        media: day.levels
          ? day.levels.includes('channels') ||
            day.levels.some((level) =>
              ['campaigns', 'adgroups', 'creatives'].includes(level),
            )
            ? String(raw.media_source || '未归因')
            : '全部渠道'
          : day.level === 'products'
            ? '全部渠道'
            : String(raw.media_source || '未归因'),
        label: day.levels
          ? groupedLabel(raw, day.levels)
          : String(
              (day.level === 'channels' ? raw.media_source : '') ||
                raw.adgroup_name ||
                raw.creative_name ||
                raw.campaign_name ||
                raw.country_code ||
                raw.producer_alias ||
                raw.buyer_alias ||
                raw.app_name ||
                '未命名',
            ),
        campaignId:
          day.levels && !day.levels.includes('campaigns')
            ? undefined
            : raw.campaign_id == null
              ? undefined
              : String(raw.campaign_id),
        campaignName:
          day.levels && !day.levels.includes('campaigns')
            ? undefined
            : raw.campaign_name == null
              ? undefined
              : String(raw.campaign_name),
        spend: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        mediaInstalls: 0,
        revenue: 0,
        events: 0,
        cpi: null,
        mediaCpi: null,
        cpm: null,
        cvr: null,
        newUserPayRate: null,
        ctr: null,
        d0Roas: null,
        missingDays: 0,
      };
      for (const field of fields)
        row[field] =
          row[field] === null || item[field] == null
            ? null
            : row[field]! + item[field]!;
      if (item.spend == null || item.revenue == null) row.missingDays++;
      result.set(key, row);
    }
  }
  for (const row of result.values()) {
    // A missing report day invalidates the period total, unlike a complete day with no row (no activity).
    if (days.some((d) => d.daily.state === 'missing'))
      for (const field of [
        'spend',
        'impressions',
        'clicks',
        'installs',
        'mediaInstalls',
      ] as const)
        row[field] = null;
    if (days.some((d) => d.revenue.state === 'missing')) row.revenue = null;
    if (days.some((d) => d.events.state === 'missing')) row.events = null;
    row.cpi = ratio(row.spend, row.installs);
    row.mediaCpi = ratio(row.spend, row.mediaInstalls);
    row.cpm = ratio(row.spend, row.impressions, 1000);
    row.cvr = cvr(row.key);
    row.newUserPayRate = paymentRate(String(row.appId));
    row.ctr = ratio(row.clicks, row.impressions, 100);
    row.d0Roas = ratio(row.revenue, row.spend, 100);
  }
  return [...result.values()].sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1));
}
