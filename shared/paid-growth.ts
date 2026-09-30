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
    String(row.app_id ?? ''),
    ...(level === 'products' ? [] : [String(row.media_source ?? '')]),
    ...BI_DIMENSIONS[level]
      .filter((k) => !k.endsWith('_name'))
      .map((k) => row[k] ?? null),
    // An absent ID must not merge different named entities.
    ...BI_DIMENSIONS[level]
      .filter((k) => k.endsWith('_name') && !row[k.replace('_name', '_id')])
      .map((k) => row[k] ?? null),
  ]);
const fields = [
  'spend',
  'impressions',
  'clicks',
  'installs',
  'mediaInstalls',
  'revenue',
  'events',
] as const;

/** Strict, weighted aggregation. Missing values stay unknown; never average ratios. */
export function biRows(days: BiDay[]): BiRow[] {
  const result = new Map<string, BiRow>();
  for (const day of days) {
    const joined = new Map<string, Partial<BiRow> & { raw: BiRawRow }>();
    for (const [part, field] of [
      [day.daily, 'daily'],
      [day.revenue, 'revenue'],
      [day.events, 'events'],
    ] as const) {
      for (const raw of part.rows) {
        const key = identity(raw, day.level);
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
        appId: Number(raw.app_id),
        appName: String(raw.app_name || '未命名产品'),
        media:
          day.level === 'products'
            ? '全部渠道'
            : String(raw.media_source || '未归因'),
        label: String(
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
          raw.campaign_id == null ? undefined : String(raw.campaign_id),
        campaignName:
          raw.campaign_name == null ? undefined : String(raw.campaign_name),
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
    row.ctr = ratio(row.clicks, row.impressions, 100);
    row.d0Roas = ratio(row.revenue, row.spend, 100);
  }
  return [...result.values()].sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1));
}
