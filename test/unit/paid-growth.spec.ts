import { biRows } from '@shared/paid-growth';
import type { BiDay } from '@shared/paid-growth.interface';
import { completeBiQuery } from '@server/modules/growth-decision/paid-growth-query';
import {
  PaidGrowthService,
  validateBiQuery,
} from '@server/modules/growth-decision/paid-growth.service';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { GrowthDecisionService } from '@server/modules/growth-decision/growth-decision.service';
import { GrowthDataFetchService } from '@server/modules/growth-decision/growth-data-fetch.service';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dimension = {
  app_id: 11,
  app_name: 'WingsLite(Android)',
  media_source: 'facebook',
};
const day = (date = '2026-09-19'): BiDay => ({
  date,
  level: 'overall',
  daily: {
    state: 'fresh',
    rows: [
      {
        ...dimension,
        spend: 10,
        impressions: 1000,
        media_clicks: 10,
        adjust_installs: 50,
        media_installs: 100,
      },
    ],
  },
  revenue: { state: 'fresh', rows: [{ ...dimension, metric_value: 5 }] },
  events: { state: 'fresh', rows: [{ ...dimension, metric_value: 20 }] },
});
describe('integrated paid growth BI', () => {
  test('weighted metrics distinguish media CPI, Adjust CPI, and full-spend D0', () => {
    const a = day(),
      b = day('2026-09-18');
    b.daily.rows[0].spend = 30;
    const row = biRows([a, b])[0];
    expect(row.spend).toBe(40);
    expect(row.cpi).toBe(0.4);
    expect(row.mediaCpi).toBe(0.2);
    expect(row.d0Roas).toBe(25);
  });
  test('missing cohort and missing report days do not become zero', () => {
    const a = day();
    a.revenue.rows = [];
    expect(biRows([a])[0].d0Roas).toBeNull();
    const b = day('2026-09-18');
    b.daily = { state: 'missing', rows: [] };
    expect(biRows([day(), b])[0].spend).toBeNull();
  });
  test('renamed campaigns merge by ID while names without IDs remain separate', () => {
    const a = day();
    a.level = 'campaigns';
    a.daily.rows = [
      { ...a.daily.rows[0], campaign_id: 'x', campaign_name: 'old' },
      { ...a.daily.rows[0], campaign_id: 'x', campaign_name: 'new' },
    ];
    a.revenue.rows = [
      {
        ...dimension,
        campaign_id: 'x',
        campaign_name: 'new',
        metric_value: 10,
      },
    ];
    a.events.rows = [];
    expect(biRows([a])).toHaveLength(1);
    expect(biRows([a])[0].spend).toBe(20);
    a.daily.rows.forEach((r) => {
      delete r.campaign_id;
    });
    expect(biRows([a])).toHaveLength(3);
  });
  test('app and channel identities are isolated', () => {
    const a = day();
    a.daily.rows.push({ ...a.daily.rows[0], app_id: 12 });
    expect(biRows([a])).toHaveLength(2);
  });
  test('rejects malformed dates and unsupported dimensions', () => {
    expect(() =>
      validateBiQuery({ date: '2026-99-01', level: 'overall' }),
    ).toThrow('日期无效');
    expect(() =>
      validateBiQuery({ date: '2026-02-30', level: 'overall' }),
    ).toThrow('日期无效');
    expect(() =>
      validateBiQuery({
        date: '2026-09-19',
        level: 'overall',
        appId: '0 OR 1',
      }),
    ).toThrow();
  });
  test('splits a capped result and reconciles additive totals', async () => {
    const query = jest.fn(async (q: Record<string, unknown>) => {
      const dims = q.dimensions as string[];
      const filter = JSON.parse(String(q.filters_json || '{}'));
      if (!dims.length) return { rows: [{ spend: 1001 }] };
      if (filter.country_code)
        return {
          rows: Array.from(
            { length: filter.country_code === 'IN' ? 500 : 501 },
            (_, i) => ({
              country_code: filter.country_code,
              campaign_id: i,
              spend: 1,
            }),
          ),
        };
      if (dims.length === 1)
        return {
          rows: [
            { country_code: 'IN', spend: 500 },
            { country_code: 'PK', spend: 501 },
          ],
        };
      return { rows: Array.from({ length: 1000 }, () => ({ spend: 1 })) };
    });
    expect(
      await completeBiQuery(query, {
        dimensions: ['country_code', 'campaign_id'],
        metrics: ['spend'],
      }),
    ).toHaveLength(1001);
  });
  test('under-limit inconsistencies fail instead of publishing incomplete rows', async () => {
    await expect(
      completeBiQuery(
        async (q) => ({
          rows: (q.dimensions as string[]).length
            ? [{ spend: 1 }]
            : [{ spend: 10 }],
        }),
        { dimensions: ['app_id'], metrics: ['spend'] },
      ),
    ).rejects.toThrow('明细与汇总不一致');
  });
});

describe('BI persistence and product registration', () => {
  let db: LocalDatabaseService, directory: string, oldPath: string | undefined;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'growth-bi-test-'));
    oldPath = process.env.GROWTH_DATABASE_PATH;
    process.env.GROWTH_DATABASE_PATH = join(directory, 'test.sqlite');
    db = new LocalDatabaseService();
  });
  afterEach(() => {
    db.onModuleDestroy();
    if (oldPath === undefined) delete process.env.GROWTH_DATABASE_PATH;
    else process.env.GROWTH_DATABASE_PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  });
  const service = (queryMetric: jest.Mock) =>
    new PaidGrowthService(
      db,
      { queryMetric } as unknown as GrowthDataFetchService,
      new GrowthDecisionService(db),
    );
  test('cached successful data survives source failure and reports stale', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const s = service(query);
    const q = { date: '2026-09-19', level: 'overall' as const };
    expect((await s.day(q)).daily.state).toBe('fresh');
    expect((await s.day(q)).daily.state).toBe('cached');
    query.mockRejectedValue(new Error('connection unavailable'));
    expect((await s.day({ ...q, refresh: '1' })).daily.state).toBe('stale');
  });
  test('adgroup queries never request unsupported cohort dimensions', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const report = await service(query).day({
      date: '2026-09-19',
      level: 'adgroups',
      appId: '11',
      media: 'facebook',
    });
    expect(report.revenue.state).toBe('unsupported');
    expect(
      query.mock.calls.every(
        (call) =>
          !(call as unknown as [Record<string, unknown>])[0].dataset
            ?.toString()
            .includes('cohort'),
      ),
    ).toBe(true);
  });
  test('registration is idempotent and never copies another product standards', async () => {
    const query = jest.fn(async (q: Record<string, unknown>) => ({
      rows: (q.dimensions as string[]).length
        ? [
            {
              app_id: 12,
              app_name: 'Mellow(Android)',
              media_source: 'facebook',
              spend: 10,
            },
          ]
        : [{ spend: 10 }],
    }));
    const s = service(query);
    const a = await s.syncProducts(),
      b = await s.syncProducts();
    expect(a[0].productId).toBe(b[0].productId);
    const product = db.getProduct(a[0].productId!)!;
    expect(product.dorisAppId).toBe(12);
    expect(product.metrics.some(m => m.key === product.targetMetric)).toBe(true);
    expect(product.campaignRules?.length || 0).toBe(0);
    expect(
      product.metrics.every(
        (m) => m.lowerBound === undefined && m.upperBound === undefined,
      ),
    ).toBe(true);
  });
});
