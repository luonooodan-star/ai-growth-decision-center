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
  media_clicks: ['media_clicks', 'clicks', 'link_clicks'],
  media_installs: ['media_installs', 'installs', 'facebook_installs'],
  adjust_installs: ['adjust_installs', 'installs', 'media_installs'],
  adjust_revenue: ['adjust_revenue', 'revenue', 'total_revenue'],
  cpi: ['cpi', 'cost_per_install'],
  ctr: ['ctr', 'click_through_rate'],
  ipm: ['ipm', 'installs_per_mille'],
  roas: ['roas', 'return_on_ad_spend'],
  d0_roas: ['d0_roas', 'roas_d0', 'cohort_roas', 'roas'],
  report_date: ['report_date', 'date', 'stat_date', 'day'],
  install_date: ['install_date', 'cohort_date', 'report_date', 'date'],
  campaign_id: ['campaign_id', 'campaignid'],
  campaign_name: ['campaign_name', 'campaign'],
  adgroup_id: ['adgroup_id', 'adset_id', 'ad_group_id'],
  adgroup_name: ['adgroup_name', 'adset_name', 'ad_group_name'],
  country_code: ['country_code', 'country', 'market'],
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
  const directRows: DorisRow[] | undefined = rowsFrom(value);
  if (directRows) return directRows;
  if (typeof value === 'string') {
    try {
      return findRows(parseJsonText(value), depth + 1);
    } catch {
      return undefined;
    }
  }
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
  if (typeof value === 'string') {
    try {
      return rowCountFrom(parseJsonText(value));
    } catch {
      return undefined;
    }
  }
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

const tableCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell: string): string => cell.trim());

const parseMarkdownTable = (text: string): DorisQueryResult | undefined => {
  const lines: string[] = text
    .split(/\r?\n/u)
    .map((line: string): string => line.trim())
    .filter(Boolean);
  const separatorIndex: number = lines.findIndex(
    (line: string, index: number) => {
      if (index === 0 || !line.includes('|')) return false;
      const cells: string[] = tableCells(line);
      return (
        cells.length > 0 &&
        cells.every((cell: string): boolean => /^:?-{3,}:?$/u.test(cell))
      );
    },
  );
  if (separatorIndex < 1) return undefined;
  const headers: string[] = tableCells(lines[separatorIndex - 1]);
  const rows: DorisRow[] = [];
  for (const line of lines.slice(separatorIndex + 1)) {
    if (!line.includes('|')) break;
    const cells: string[] = tableCells(line);
    if (cells.length !== headers.length) continue;
    rows.push(
      Object.fromEntries(
        headers.map((header: string, index: number): [string, string] => [
          header,
          cells[index] || '',
        ]),
      ),
    );
  }
  return rows.length ? { rows, row_count: rows.length } : undefined;
};

const parseTabbedTable = (text: string): DorisQueryResult | undefined => {
  const lines: string[] = text
    .split(/\r?\n/u)
    .map((line: string): string => line.trim())
    .filter(Boolean);
  if (lines.length < 2 || !lines[0]?.includes('\t')) return undefined;
  const headers: string[] = lines[0]
    .split('\t')
    .map((cell: string) => cell.trim());
  const rows: DorisRow[] = lines
    .slice(1)
    .flatMap((line: string): DorisRow[] => {
      const cells: string[] = line
        .split('\t')
        .map((cell: string) => cell.trim());
      return cells.length === headers.length
        ? [
            Object.fromEntries(
              headers.map((header: string, index: number) => [
                header,
                cells[index],
              ]),
            ),
          ]
        : [];
    });
  return rows.length ? { rows, row_count: rows.length } : undefined;
};

const parseJsonText = (text: string): unknown => {
  const trimmed: string = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced: RegExpMatchArray | null = trimmed.match(
      /```(?:json)?\s*([\s\S]*?)```/iu,
    );
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // Continue with table and embedded JSON parsing.
      }
    }
    const markdownTable: DorisQueryResult | undefined =
      parseMarkdownTable(trimmed);
    if (markdownTable) return markdownTable;
    const tabbedTable: DorisQueryResult | undefined = parseTabbedTable(trimmed);
    if (tabbedTable) return tabbedTable;
    for (const [opening, closing] of [
      ['{', '}'],
      ['[', ']'],
    ] as const) {
      const start: number = trimmed.indexOf(opening);
      const end: number = trimmed.lastIndexOf(closing);
      if (start < 0 || end <= start) continue;
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Try the next supported representation.
      }
    }
    const excerpt: string = trimmed.replace(/\s+/gu, ' ').slice(0, 240);
    throw new Error(
      excerpt ? `Doris MCP 查询失败：${excerpt}` : 'Doris MCP 未返回数据',
    );
  }
};

const parseMcpHttpPayload = (raw: string, contentType: string): unknown => {
  if (!raw.trim()) return null;
  if (!contentType.includes('text/event-stream')) return JSON.parse(raw);
  const payloads: unknown[] = raw
    .split(/\r?\n/u)
    .filter((line: string): boolean => line.startsWith('data:'))
    .map((line: string): string => line.slice(5).trim())
    .filter((line: string): boolean => Boolean(line) && line !== '[DONE]')
    .map((line: string): unknown => JSON.parse(line));
  if (!payloads.length) {
    throw new Error('Doris MCP SSE 未返回可解析事件');
  }
  return payloads[payloads.length - 1];
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

export {
  dorisNumber,
  dorisString,
  normalizeDorisQueryResult,
  parseMcpHttpPayload,
};
export type { DorisQueryResult, DorisRow };
