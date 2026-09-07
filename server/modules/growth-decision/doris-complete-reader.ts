import type {
  GrowthFetchCheckpoint,
  GrowthFetchRun,
} from '@shared/api.interface';
import { campaignHash } from './campaign-snapshots';
import {
  dorisNumber,
  dorisString,
  dorisValue,
  type DorisQueryResult,
  type DorisRow,
} from './doris-result-normalizer';

type Query = Record<string, unknown>;
interface ReaderOptions {
  productId: string;
  resume: boolean;
  query: (args: Query) => Promise<DorisQueryResult>;
  getCheckpoint: (key: string) => GrowthFetchCheckpoint | undefined;
  saveCheckpoint: (value: GrowthFetchCheckpoint) => void;
  progress: (
    phase: NonNullable<GrowthFetchRun['phase']>,
    current: string,
    reused?: boolean,
  ) => void;
  gap: (gap: NonNullable<GrowthFetchRun['gaps']>[number]) => void;
}

const LIMIT = 1000;
const saturated = (r: DorisQueryResult): boolean =>
  Boolean(r.truncated) ||
  (r.rows?.length || 0) >= LIMIT ||
  Number(r.row_count || 0) > (r.rows?.length || 0);
const dates = (start: string, end: string): string[] => {
  const result: string[] = [];
  for (
    let day = start;
    day <= end && result.length < 32;
    day = new Date(new Date(day + 'T00:00:00Z').getTime() + 86400000)
      .toISOString()
      .slice(0, 10)
  )
    result.push(day);
  return result;
};
// Match SQL SUM: explicit NULL is excluded, but absent/invalid fields are errors.
// This changes reconciliation only; the original rows keep their NULL values.
const sum = (rows: DorisRow[], metric: string): number | null | undefined => {
  const values: number[] = [];
  for (const row of rows) {
    if (dorisValue(row, metric) === null) continue;
    const value = dorisNumber(row, metric);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};
const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 0.00001);

/** No invented offset: enumerate a bounded ID manifest, then query disjoint ID batches. */
export class DorisCompleteReader {
  private requests = 0;
  constructor(private readonly options: ReaderOptions) {}

  private async query(args: Query): Promise<DorisQueryResult> {
    if (++this.requests > 1500)
      throw new Error('本轮查询预算已达上限，已保存断点，请继续补齐');
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.options.query({ ...args, limit: LIMIT });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          attempt >= 2 ||
          !/timeout|timed out|fetch failed|ECONN|429|502|503|504|超时/i.test(
            message,
          )
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
  }

  async read(
    primary: Query,
    fallback: Query,
    label: string,
  ): Promise<DorisQueryResult> {
    const rows: DorisRow[] = [];
    for (const day of dates(
      String(primary.start_date),
      String(primary.end_date),
    )) {
      try {
        rows.push(
          ...(await this.readDay(
            { ...primary, start_date: day, end_date: day },
            { ...fallback, start_date: day, end_date: day },
            label,
          )),
        );
      } catch (error: unknown) {
        this.options.gap({
          dataset: String(primary.dataset),
          dataDate: day,
          message: `${label}：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    return { rows, row_count: rows.length };
  }

  private async details(
    primary: Query,
    fallback: Query,
  ): Promise<DorisQueryResult> {
    try {
      return await this.query(primary);
    } catch (error: unknown) {
      // Only unsupported dimensions/metrics use the reduced contract; network/auth errors retain their cause.
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/metric|dimension|column|field|指标|维度|字段|not allowed|not supported|unknown/i.test(
          message,
        )
      )
        throw error;
      return this.query(fallback);
    }
  }

  private async readDay(
    primary: Query,
    fallback: Query,
    label: string,
  ): Promise<DorisRow[]> {
    const day = String(primary.start_date);
    const cohort = String(primary.dataset).includes('cohort');
    const dateColumn = cohort ? 'install_date' : 'report_date';
    const metrics = cohort
      ? [
          'cohort_spend',
          ...((fallback.metrics as string[]).includes('cumulative_metric_value')
            ? ['cumulative_metric_value']
            : []),
          'd0_roas',
        ]
      : ['spend', 'impressions'];
    const aggregateQuery = { ...primary, dimensions: [dateColumn], metrics };
    const before = await this.query(aggregateQuery);
    if (saturated(before) || (before.rows?.length || 0) > 1)
      throw new Error('汇总口径未能唯一确认');
    const fingerprint = campaignHash(before.rows || []);
    const directKey = this.key(primary, fingerprint);
    const cached = this.cached(directKey);
    let result: DorisRow[];
    if (cached) {
      result = cached;
      this.options.progress(
        'repairing',
        `${day} ${label}：复用已完成分片`,
        true,
      );
    } else {
      this.options.progress('fetching', `${day} ${label}`);
      const direct = await this.details(primary, fallback);
      if (!saturated(direct)) result = direct.rows || [];
      else {
        this.options.progress('repairing', `${day} ${label}：自动拆分系列`);
        const ids = await this.manifest(primary, 'campaign_id', metrics[0]);
        result = [];
        for (let i = 0; i < ids.length; i += 100) {
          const filter = {
            ...this.filters(primary),
            campaign_id: ids.slice(i, i + 100),
          };
          result.push(
            ...(await this.batch(
              { ...primary, filters_json: JSON.stringify(filter) },
              { ...fallback, filters_json: JSON.stringify(filter) },
              fingerprint,
              label,
              0,
            )),
          );
        }
      }
      result = this.unique(result, primary);
    }
    this.options.progress('validating', `${day} ${label}：核对汇总`);
    const after = await this.query(aggregateQuery);
    if (saturated(after) || campaignHash(after.rows || []) !== fingerprint)
      throw new Error('抓取期间上游汇总发生变化，保留旧快照，下一轮重新校验');
    this.validate(result, before.rows || [], metrics, cohort);
    this.options.saveCheckpoint({
      key: directKey,
      productId: this.options.productId,
      updatedAt: new Date().toISOString(),
      rows: result,
    });
    this.options.progress('fetching', `${day} ${label}：完整性校验通过`);
    return result;
  }

  private filters(args: Query): Query {
    return JSON.parse(String(args.filters_json || '{}'));
  }
  private key(args: Query, fingerprint: string): string {
    return campaignHash([
      'complete-v2-sql-null',
      this.options.productId,
      args,
      fingerprint,
    ]);
  }
  private cached(key: string): DorisRow[] | undefined {
    if (!this.options.resume) return undefined;
    const saved = this.options.getCheckpoint(key);
    return saved && Date.now() - Date.parse(saved.updatedAt) < 2 * 3600_000
      ? saved.rows
      : undefined;
  }

  private async manifest(
    args: Query,
    dimension: string,
    metric: string,
  ): Promise<string[]> {
    const query = { ...args, dimensions: [dimension], metrics: [metric] };
    const result = await this.query(query);
    if (!saturated(result)) return this.ids(result.rows || [], dimension);
    // Discover country partitions from the source, never use a frozen account/campaign list.
    const filters = this.filters(args);
    if (
      filters.country_code &&
      (!Array.isArray(filters.country_code) ||
        filters.country_code.length === 1)
    )
      throw new Error(
        `${dimension} 清单仍达到 1000 行，接口缺少分页能力，无法证明完整`,
      );
    const countries = await this.query({
      ...args,
      dimensions: ['country_code'],
      metrics: [metric],
    });
    if (saturated(countries))
      throw new Error('国家清单截断，需 Doris MCP 提供稳定分页');
    const ids = new Set<string>();
    for (const country of this.ids(countries.rows || [], 'country_code')) {
      const partition = await this.query({
        ...query,
        filters_json: JSON.stringify({ ...filters, country_code: [country] }),
      });
      if (saturated(partition))
        throw new Error(
          `${country} 的 ${dimension} 清单达到上限，需接口提供分页`,
        );
      for (const id of this.ids(partition.rows || [], dimension)) ids.add(id);
    }
    if (!ids.size) throw new Error('发现清单为空，不能用空清单代替截断数据');
    return [...ids].sort();
  }

  private ids(rows: DorisRow[], field: string): string[] {
    const ids = rows.map((row) => dorisString(row, field));
    if (ids.some((id) => !id))
      throw new Error(`${field} 存在空值，无法安全分片`);
    return [...new Set(ids as string[])].sort();
  }

  private async batch(
    primary: Query,
    fallback: Query,
    fingerprint: string,
    label: string,
    depth: number,
  ): Promise<DorisRow[]> {
    if (depth > 16) throw new Error('最小分片仍然超限，需 Doris MCP 提供分页');
    const key = this.key(primary, fingerprint);
    const cached = this.cached(key);
    if (cached) {
      this.options.progress(
        'repairing',
        `${primary.start_date} ${label}：续用分片`,
        true,
      );
      return cached;
    }
    const result = await this.details(primary, fallback);
    if (!saturated(result)) {
      const rows = this.unique(result.rows || [], primary);
      this.options.saveCheckpoint({
        key,
        productId: this.options.productId,
        updatedAt: new Date().toISOString(),
        rows,
      });
      this.options.progress(
        'repairing',
        `${primary.start_date} ${label}：已完成分片`,
      );
      return rows;
    }
    const filters = this.filters(primary);
    const field = ['campaign_id', 'adgroup_id', 'ad_id'].find(
      (f) => Array.isArray(filters[f]) && filters[f].length > 1,
    );
    let partitions: Query[];
    if (field) {
      const values = filters[field] as string[];
      const mid = Math.ceil(values.length / 2);
      partitions = [values.slice(0, mid), values.slice(mid)].map((ids) => ({
        ...filters,
        [field]: ids,
      }));
    } else {
      const dimensions = fallback.dimensions as string[];
      const next = ['adgroup_id', 'ad_id'].find(
        (f) => dimensions.includes(f) && !filters[f],
      );
      if (!next) throw new Error('单系列最小分片仍达到查询上限，无法安全补齐');
      const ids = await this.manifest(
        primary,
        next,
        String(primary.dataset).includes('cohort') ? 'cohort_spend' : 'spend',
      );
      partitions = ids.map((id) => ({ ...filters, [next]: [id] }));
    }
    const rows: DorisRow[] = [];
    for (const partition of partitions) {
      rows.push(
        ...(await this.batch(
          { ...primary, filters_json: JSON.stringify(partition) },
          { ...fallback, filters_json: JSON.stringify(partition) },
          fingerprint,
          label,
          depth + 1,
        )),
      );
    }
    return rows;
  }

  private unique(rows: DorisRow[], args: Query): DorisRow[] {
    const result = new Map<string, DorisRow>();
    const dimensions = args.dimensions as string[];
    const filters = this.filters(args);
    for (const source of rows) {
      const row = { ...source };
      for (const dimension of dimensions) {
        const values = Array.isArray(filters[dimension])
          ? (filters[dimension] as unknown[])
          : filters[dimension] !== undefined
            ? [filters[dimension]]
            : [];
        if (!dorisString(row, dimension) && values.length === 1)
          row[dimension] = values[0];
        if (
          values.length &&
          dorisString(row, dimension) &&
          !values.map(String).includes(dorisString(row, dimension)!)
        )
          throw new Error('返回明细超出分片筛选范围');
      }
      const dateField = String(args.dataset).includes('cohort')
        ? 'install_date'
        : 'report_date';
      if (dorisString(row, dateField) !== String(args.start_date))
        throw new Error('返回明细数据日与请求不一致');
      const key = JSON.stringify(
        dimensions.map((d) => dorisString(row, d) || null),
      );
      const previous = result.get(key);
      if (previous && campaignHash(previous) !== campaignHash(row))
        throw new Error('相同维度返回冲突数据，需重新校验');
      result.set(key, row);
    }
    return [...result.values()];
  }

  private validate(
    rows: DorisRow[],
    aggregates: DorisRow[],
    metrics: string[],
    cohort: boolean,
  ): void {
    if (!aggregates.length) {
      if (rows.length) throw new Error('明细与空汇总不一致');
      return;
    }
    for (const metric of metrics.filter((m) => m !== 'd0_roas')) {
      const expected = dorisNumber(aggregates[0], metric);
      const actual = sum(rows, metric);
      if (dorisValue(aggregates[0], metric) === null && actual === null)
        continue;
      if (
        expected === undefined ||
        actual === undefined ||
        actual === null ||
        !close(expected, actual)
      )
        throw new Error(
          `${metric} 明细与汇总不一致（汇总 ${expected ?? 'NULL/缺失'}，明细 ${actual ?? 'NULL/缺失'}，${rows.length} 行），未发布本日数据`,
        );
    }
    if (cohort) {
      const expected = dorisNumber(aggregates[0], 'd0_roas');
      const total = sum(rows, 'cohort_spend') || 0;
      if (total > 0) {
        if (expected === undefined)
          throw new Error('有消耗的 cohort 汇总缺少 D0 ROAS');
        if (
          rows.some(
            (r) =>
              (dorisNumber(r, 'cohort_spend') || 0) !== 0 &&
              dorisNumber(r, 'd0_roas') === undefined,
          )
        )
          throw new Error('部分 cohort 缺少 D0 ROAS');
        const actual = metrics.includes('cumulative_metric_value')
          ? (sum(rows, 'cumulative_metric_value') ?? 0) / total
          : rows.reduce(
              (s, r) =>
                s +
                (dorisNumber(r, 'cohort_spend') || 0) *
                  (dorisNumber(r, 'd0_roas') || 0),
              0,
            ) / total;
        if (!close(expected, actual))
          throw new Error('D0 ROAS 与相同口径汇总不一致');
      }
    }
  }
}
