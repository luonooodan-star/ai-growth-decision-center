import { DorisCompleteReader } from '@server/modules/growth-decision/doris-complete-reader';
import { DorisQueryGate } from '@server/modules/growth-decision/doris-query-gate';
import {
  normalizeDorisQueryResult,
  type DorisRow,
  type DorisQueryResult,
} from '@server/modules/growth-decision/doris-result-normalizer';
import type {
  GrowthFetchCheckpoint,
  GrowthFetchRun,
} from '@shared/api.interface';

type Query = Record<string, unknown>;
const day = '2026-09-01';
const args: Query = {
  dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
  start_date: day,
  end_date: day,
  dimensions: ['install_date', 'campaign_id', 'campaign_name'],
  metrics: ['cohort_spend', 'd0_roas'],
  filters_json: '{}',
};
const source = (size: number, countryCount = 3): DorisRow[] =>
  Array.from({ length: size }, (_, i) => ({
    install_date: day,
    campaign_id: String(i),
    campaign_name: 'Campaign ' + i,
    country_code: ['IN', 'PK', 'BD'][i % countryCount],
    cohort_spend: i + 1,
    d0_roas: 0.1 + (i % 9) / 10,
  }));
function fixtureQuery(
  data: DorisRow[],
): (q: Query) => Promise<DorisQueryResult> {
  return async (q) => {
    const filters = JSON.parse(String(q.filters_json || '{}'));
    const dimensions = q.dimensions as string[];
    const selected = data.filter(
      (row) =>
        String(row.install_date) >= String(q.start_date) &&
        String(row.install_date) <= String(q.end_date) &&
        Object.entries(filters).every(([key, value]) =>
          (Array.isArray(value) ? value.map(String) : [String(value)]).includes(
            String(row[key]),
          ),
        ),
    );
    const groups = new Map<string, DorisRow[]>();
    for (const row of selected) {
      const key = JSON.stringify(dimensions.map((d) => row[d]));
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    const rows = [...groups.values()]
      .map((items) => {
        const spend = items.reduce((s, row) => s + Number(row.cohort_spend), 0);
        return {
          ...Object.fromEntries(dimensions.map((d) => [d, items[0][d]])),
          cohort_spend: spend,
          d0_roas:
            items.reduce(
              (s, row) => s + Number(row.cohort_spend) * Number(row.d0_roas),
              0,
            ) / spend,
        };
      })
      .slice(0, Number(q.limit));
    return { rows, row_count: rows.length };
  };
}
function setup(
  query: (q: Query) => Promise<DorisQueryResult>,
  cache = new Map<string, GrowthFetchCheckpoint>(),
  resume = false,
) {
  const gaps: NonNullable<GrowthFetchRun['gaps']> = [];
  const progress = jest.fn();
  const reader = new DorisCompleteReader({
    productId: 'fixture',
    query,
    resume,
    getCheckpoint: (key) => cache.get(key),
    saveCheckpoint: (c) => {
      cache.set(c.key, c);
    },
    progress,
    gap: (gap) => gaps.push(gap),
  });
  return { reader, gaps, progress, cache };
}

describe('complete Doris reads', () => {
  it.each([999, 1000, 1501])(
    'reads %i rows without losing capped campaigns',
    async (size) => {
      const { reader, gaps } = setup(fixtureQuery(source(size)));
      const result = await reader.read(args, args, 'cohort 明细');
      expect(result.rows).toHaveLength(size);
      expect(gaps).toEqual([]);
    },
  );
  it('splits a multi-day history before requesting details', async () => {
    const data = source(450);
    const query = jest.fn(
      fixtureQuery([
        ...data,
        ...data.map((row) => ({ ...row, install_date: '2026-09-02' })),
        ...data.map((row) => ({ ...row, install_date: '2026-09-03' })),
      ]),
    );
    const { reader, gaps } = setup(query);
    const multi = { ...args, end_date: '2026-09-03' };
    expect((await reader.read(multi, multi, 'cohort 明细')).rows).toHaveLength(
      1350,
    );
    expect(
      query.mock.calls.every(
        ([q]) => q.start_date === q.end_date && q.limit === 1000,
      ),
    ).toBe(true);
    expect(gaps).toEqual([]);
  });
  it('fails closed when one country manifest cannot be enumerated', async () => {
    const { reader, gaps } = setup(fixtureQuery(source(1100, 1)));
    expect((await reader.read(args, args, 'cohort')).rows).toEqual([]);
    expect(gaps[0].message).toContain('分页');
  });
  it('detects silently incomplete details below the cap through aggregate reconciliation', async () => {
    const fixture = fixtureQuery(source(900));
    const { reader, gaps } = setup(async (q) => {
      const result = await fixture(q);
      return (q.dimensions as string[]).includes('campaign_name')
        ? { rows: result.rows?.slice(0, 899), row_count: 899 }
        : result;
    });
    expect((await reader.read(args, args, 'cohort')).rows).toEqual([]);
    expect(gaps[0].message).toContain('汇总不一致');
  });
  it('deduplicates identical rows and refuses conflicting copies', async () => {
    for (const conflict of [false, true]) {
      const fixture = fixtureQuery(source(10));
      const { reader, gaps } = setup(async (q) => {
        const result = await fixture(q);
        if ((q.dimensions as string[]).includes('campaign_name'))
          result.rows?.push({
            ...result.rows[0],
            ...(conflict ? { d0_roas: 9 } : {}),
          });
        return result;
      });
      const result = await reader.read(args, args, 'cohort');
      expect(result.rows).toHaveLength(conflict ? 0 : 10);
      expect(gaps).toHaveLength(conflict ? 1 : 0);
    }
  });
  it('resumes successful partitions after failure and a new reader instance', async () => {
    const fixture = fixtureQuery(source(1200));
    let failure = true;
    const query = jest.fn(async (q: Query) => {
      const ids = JSON.parse(String(q.filters_json)).campaign_id;
      if (failure && Array.isArray(ids) && ids.includes('200'))
        throw new Error('fixture interrupted');
      return fixture(q);
    });
    const first = setup(query);
    expect((await first.reader.read(args, args, 'cohort')).rows).toEqual([]);
    expect(first.cache.size).toBeGreaterThan(0);
    failure = false;
    const next = setup(query, first.cache, true);
    expect((await next.reader.read(args, args, 'cohort')).rows).toHaveLength(
      1200,
    );
    expect(next.progress.mock.calls.some((call) => call[2] === true)).toBe(
      true,
    );
    expect(next.gaps).toEqual([]);
  });
  it('invalidates cached rows when upstream aggregate changes', async () => {
    const data = source(10);
    const first = setup(fixtureQuery(data));
    await first.reader.read(args, args, 'cohort');
    const changed = data.map((row) => ({ ...row, cohort_spend: 50 }));
    const next = setup(fixtureQuery(changed), first.cache, true);
    const result = await next.reader.read(args, args, 'cohort');
    expect(result.rows?.every((row) => row.cohort_spend === 50)).toBe(true);
    expect(next.progress.mock.calls.some((call) => call[2] === true)).toBe(
      false,
    );
  });
  it('retains explicit upstream truncation flags', () => {
    expect(
      normalizeDorisQueryResult({
        result: { rows: [{ value: 1 }], metadata: { has_more: true } },
      }).truncated,
    ).toBe(true);
  });
  it('limits all concurrent queries to two permits', async () => {
    const gate = new DorisQueryGate();
    let active = 0,
      maximum = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        gate.run(async () => {
          active++;
          maximum = Math.max(maximum, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active--;
        }),
      ),
    );
    expect(maximum).toBe(2);
  });
});
