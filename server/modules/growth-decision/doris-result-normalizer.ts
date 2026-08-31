type DorisRow = Record<string, unknown>;

interface DorisQueryResult {
  row_count?: number;
  rows?: DorisRow[];
}

const DORIS_COLUMN_ALIASES: Record<string, string[]> = {
  spend: [
    'spend',
    'amount_spent',
    'ad_spend',
    'media_spend',
    'total_spend',
    'cost',
    'cohort_spend',
  ],
  cohort_spend: ['cohort_spend', 'spend', 'amount_spent', 'cost'],
  impressions: ['impressions', 'media_impressions', 'total_impressions'],
  adjust_installs: ['adjust_installs', 'installs', 'media_installs'],
  adjust_revenue: ['adjust_revenue', 'revenue', 'total_revenue'],
  cpi: ['cpi', 'cost_per_install'],
  d0_roas: ['d0_roas', 'roas_d0', 'cohort_roas', 'roas'],
  report_date: ['report_date', 'date', 'stat_date', 'day'],
  install_date: ['install_date', 'cohort_date', 'report_date', 'date'],
  campaign_id: ['campaign_id', 'campaignid'],
  campaign_name: ['campaign_name', 'campaign'],
  adgroup_id: ['adgroup_id', 'adset_id', 'ad_group_id'],
  adgroup_name: ['adgroup_name', 'adset_name', 'ad_group_name'],
};

const normalizeColumnName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');

const asObject = (value: unknown): DorisRow | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as DorisRow)
    : undefined;

const rowsFrom = (value: unknown): DorisRow[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const rows: DorisRow[] = [];
  for (const item of value) {
    const row: DorisRow | undefined = asObject(item);
    if (row) rows.push(row);
  }
  return rows;
};

const findRows = (value: unknown, depth = 0): DorisRow[] | undefined => {
  if (depth > 4) return undefined;
  const object: DorisRow | undefined = asObject(value);
  if (!object) return undefined;
  for (const key of ['rows', 'data', 'records', 'items']) {
    const rows: DorisRow[] | undefined = rowsFrom(object[key]);
    if (rows) return rows;
  }
  for (const key of ['result', 'data', 'query_result', 'payload']) {
    const nestedRows: DorisRow[] | undefined = findRows(object[key], depth + 1);
    if (nestedRows) return nestedRows;
  }
  return undefined;
};

const rowCountFrom = (value: unknown): number | undefined => {
  const object: DorisRow | undefined = asObject(value);
  if (!object) return undefined;
  for (const key of ['row_count', 'rowCount', 'total']) {
    const parsed: number = Number(object[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  for (const key of ['result', 'data', 'query_result', 'payload']) {
    const nested: number | undefined = rowCountFrom(object[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

const parseJsonText = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    const start: number = text.indexOf('{');
    const end: number = text.lastIndexOf('}');
    if (start < 0 || end <= start)
      throw new Error('Doris MCP 返回了非 JSON 数据');
    return JSON.parse(text.slice(start, end + 1));
  }
};

const normalizeDorisQueryResult = (value: unknown): DorisQueryResult => {
  const parsed: unknown =
    typeof value === 'string' ? parseJsonText(value) : value;
  const rows: DorisRow[] = findRows(parsed) || [];
  const reportedCount: number | undefined = rowCountFrom(parsed);
  return {
    rows,
    row_count:
      reportedCount === undefined
        ? rows.length
        : Math.max(reportedCount, rows.length),
  };
};

const dorisValue = (row: DorisRow, canonicalName: string): unknown => {
  const aliases: string[] = DORIS_COLUMN_ALIASES[canonicalName] || [
    canonicalName,
  ];
  const entries: Array<[string, unknown]> = Object.entries(row).map(
    ([key, value]: [string, unknown]): [string, unknown] => [
      normalizeColumnName(key),
      value,
    ],
  );
  for (const alias of aliases) {
    const normalizedAlias: string = normalizeColumnName(alias);
    const exact: [string, unknown] | undefined = entries.find(
      ([key]: [string, unknown]): boolean => key === normalizedAlias,
    );
    if (exact) return exact[1];
  }
  for (const alias of aliases) {
    const normalizedAlias: string = normalizeColumnName(alias);
    const aggregate: [string, unknown] | undefined = entries.find(
      ([key]: [string, unknown]): boolean =>
        key.endsWith(`_${normalizedAlias}`) ||
        key.startsWith(`${normalizedAlias}_`),
    );
    if (aggregate) return aggregate[1];
  }
  return undefined;
};

const dorisNumber = (
  row: DorisRow,
  canonicalName: string,
): number | undefined => {
  const value: unknown = dorisValue(row, canonicalName);
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const text: string = String(value).trim();
  const isPercent: boolean = text.endsWith('%');
  const parsed: number = Number(text.replace(/[$,%\s]/gu, ''));
  if (!Number.isFinite(parsed)) return undefined;
  return isPercent ? parsed / 100 : parsed;
};

const dorisString = (
  row: DorisRow,
  canonicalName: string,
): string | undefined => {
  const value: unknown = dorisValue(row, canonicalName);
  if (value === null || value === undefined) return undefined;
  const text: string = String(value).trim();
  return text || undefined;
};

export { dorisNumber, dorisString, normalizeDorisQueryResult };
export type { DorisQueryResult, DorisRow };
