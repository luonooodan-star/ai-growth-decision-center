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
  const deadline = Date.now() + 120000;
  const run = async (q: Query) => {
    if (Date.now() > deadline)
      throw new Error('本次查询超过两分钟，请缩小产品 / 渠道范围后重试');
    if (++calls > 300)
      throw new Error('查询分片超过本次安全上限；请缩小产品 / 渠道范围');
    return query({ ...q, limit: 1000 });
  };
  const read = async (q: Query): Promise<DorisRow[]> => {
    const result = await run(q);
    if (!saturated(result)) return result.rows || [];
    const filters = JSON.parse(String(q.filters_json || '{}')) as Record<
      string,
      unknown
    >;
    for (const field of q.dimensions as string[]) {
      if (Object.hasOwn(filters, field)) continue;
      const manifest = await run({ ...q, dimensions: [field] });
      if (
        saturated(manifest) ||
        !manifest.rows?.length ||
        manifest.rows.some((r) => r[field] == null)
      )
        continue;
      const groups = manifest.rows;
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
