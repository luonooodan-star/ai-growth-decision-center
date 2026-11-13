import type { DorisQueryResult, DorisRow } from './doris-result-normalizer';

type Query = Record<string, unknown>;
const saturated = (r: DorisQueryResult) =>
  r.truncated ||
  (r.rows?.length || 0) >= 1000 ||
  Number(r.row_count || 0) > (r.rows?.length || 0);
/** Split by disjoint dimension manifests, never use an invented offset or publish a capped result. */
export async function completeBiQuery(
  query: (args: Query) => Promise<DorisQueryResult>,
  args: Query,
): Promise<DorisRow[]> {
  let calls = 0;
  let active = 0;
  const waiting: Array<() => void> = [];
  const deadline = Date.now() + 120000;
  const run = async (q: Query) => {
    if (Date.now() > deadline)
      throw new Error('本次查询超过两分钟，请缩小产品 / 渠道范围后重试');
    if (++calls > 300)
      throw new Error('查询分片超过本次安全上限；请缩小产品 / 渠道范围');
    await new Promise<void>((resolve) => {
      if (active < 2) {
        active++;
        resolve();
      } else waiting.push(resolve);
    });
    try {
      if (Date.now() > deadline)
        throw new Error('本次查询超过两分钟，请缩小产品 / 渠道范围后重试');
      return await query({ ...q, limit: 1000 });
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
  const read = async (q: Query): Promise<DorisRow[]> => {
    const result = await run(q);
    if (!saturated(result)) return result.rows || [];
    const filters = JSON.parse(String(q.filters_json || '{}')) as Record<
      string,
      unknown
    >;
    // The caller already knows the disjoint user ID manifest. An IN filter
    // must be subdivided too; skipping every filtered dimension made large
    // user-event queries impossible to complete when other fields contained NULL.
    const dimensions = q.dimensions as string[];
    const arrayField = dimensions.find(
      (field) =>
        Array.isArray(filters[field]) &&
        (filters[field] as unknown[]).every(
          (v) => v !== null && v !== undefined,
        ) &&
        new Set(filters[field] as unknown[]).size > 1,
    );
    if (arrayField) {
      const values = [...new Set(filters[arrayField] as unknown[])];
      const total = await run({ ...q, dimensions: [] });
      if (saturated(total) || (total.rows?.length || 0) > 1)
        throw new Error('无法确认分片汇总口径');
      const midpoint = Math.ceil(values.length / 2);
      const pieces = await Promise.allSettled(
        [values.slice(0, midpoint), values.slice(midpoint)].map((values) =>
          read({
            ...q,
            filters_json: JSON.stringify({ ...filters, [arrayField]: values }),
          }),
        ),
      );
      const failure = pieces.find((p) => p.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      const rows = pieces.flatMap((p) =>
        p.status === 'fulfilled' ? p.value : [],
      );
      if (total.rows?.[0])
        reconcile(rows, total.rows[0], q.metrics as string[]);
      else if (rows.length) throw new Error('分片明细与汇总不一致');
      return rows;
    }
    let selected: { field: string; groups: DorisRow[] } | undefined;
    const candidates = [...dimensions].sort((a, b) => {
      const rank = (field: string) =>
        field === 'buyer_alias'
          ? 0
          : field === 'country_code'
            ? 1
            : field.endsWith('_name')
              ? 3
              : 2;
      return rank(a) - rank(b);
    });
    for (const field of candidates) {
      if (Object.hasOwn(filters, field)) continue;
      if (
        field.endsWith('_name') &&
        dimensions.includes(field.replace(/_name$/, '_id'))
      )
        continue;
      const manifest = await run({ ...q, dimensions: [field] });
      if (
        saturated(manifest) ||
        (manifest.rows?.length || 0) < 2 ||
        manifest.rows.some((r) => r[field] == null)
      )
        continue;
      if (!selected || manifest.rows!.length < selected.groups.length)
        selected = { field, groups: manifest.rows! };
      if (selected.groups.length <= 4) break;
    }
    if (selected) {
      const { field, groups } = selected;
      const results: DorisRow[][] = new Array(groups.length);
      let cursor = 0;
      let failed = false;
      const worker = async () => {
        while (!failed && cursor < groups.length) {
          const index = cursor++;
          const group = groups[index];
          try {
            const part = await read({
              ...q,
              filters_json: JSON.stringify({
                ...filters,
                [field]: group[field],
              }),
            });
            reconcile(part, group, q.metrics as string[]);
            results[index] = part;
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      };
      // Await both workers even on failure; never publish partial shards.
      const finished = await Promise.allSettled([worker(), worker()]);
      const error = finished.find((r) => r.status === 'rejected');
      if (error?.status === 'rejected') throw error.reason;
      return results.flat();
    }
    throw new Error(
      '明细达到 1000 行且无法安全分片；未发布截断数据，请缩小范围',
    );
  };
  const before = await run({ ...args, dimensions: [] });
  if (saturated(before) || (before.rows?.length || 0) > 1)
    throw new Error('无法确认汇总口径');
  const rows = await read(args);
  if (before.rows?.[0])
    reconcile(rows, before.rows[0], args.metrics as string[]);
  else if (rows.length) throw new Error('明细与汇总行数不一致，请重试');
  return rows;
}
function reconcile(rows: DorisRow[], total: DorisRow, metrics: string[]): void {
  for (const key of metrics) {
    if (total[key] == null) continue;
    const values = rows.map((r) => r[key]);
    if (
      values.some(
        (v) => v === undefined || (v !== null && !Number.isFinite(Number(v))),
      )
    )
      throw new Error(`${key} 明细缺失`);
    const actual = values.reduce<number>((n, v) => n + Number(v || 0), 0),
      expected = Number(total[key]);
    if (
      !Number.isFinite(expected) ||
      Math.abs(actual - expected) > Math.max(0.01, Math.abs(expected) * 0.00001)
    )
      throw new Error(
        `${key} 明细与汇总不一致（可能更新中）；保留旧缓存，请重试`,
      );
  }
}
