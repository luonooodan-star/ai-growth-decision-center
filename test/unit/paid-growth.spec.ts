import { biRows } from '@shared/paid-growth';
import type { BiDay } from '@shared/paid-growth.interface';
import { completeBiQuery } from '@server/modules/growth-decision/paid-growth-query';
import {
  PaidGrowthService,
  biQueryLevels,
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
  test('500 campaigns across countries use low-cardinality shards, not 500 campaign requests', async () => {
    const rows = ['IN', 'US', 'BR'].flatMap((country_code) =>
      Array.from({ length: 500 }, (_, i) => ({
        campaign_id: String(i + 1),
        campaign_name: `Campaign ${i}`,
        buyer_alias: 'alice',
        country_code,
        spend: 1,
      })),
    );
    const query = jest.fn(async (q: Record<string, unknown>) => {
      const dims = q.dimensions as string[];
      const filters = JSON.parse(String(q.filters_json || '{}'));
      if (!dims.length) return { rows: [{ spend: 1500 }] };
      if (dims.length === 1 && dims[0] === 'buyer_alias')
        return { rows: [{ buyer_alias: 'alice', spend: 1500 }] };
      if (dims.length === 1 && dims[0] === 'country_code')
        return {
          rows: ['IN', 'US', 'BR'].map((country_code) => ({
            country_code,
            spend: 500,
          })),
        };
      if (dims.length === 1)
        throw Error('Should not enumerate hundreds of campaigns');
      const selected = filters.country_code
        ? rows.filter((r) => r.country_code === filters.country_code)
        : rows;
      return {
        rows: selected.slice(0, 1000),
        truncated: selected.length > 1000,
      };
    });
    expect(
      await completeBiQuery(query, {
        dimensions: [
          'campaign_id',
          'campaign_name',
          'buyer_alias',
          'country_code',
        ],
        metrics: ['spend'],
        filters_json: '{}',
      }),
    ).toHaveLength(1500);
    expect(query).toHaveBeenCalledTimes(7);
  });
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
    a.daily.rows.push({
      ...a.daily.rows[0],
      media_source: 'facebook_web',
      spend: 7,
    });
    expect(biRows([a])).toHaveLength(3);
    expect(biRows([a]).find((r) => r.media === 'facebook')?.spend).toBe(10);
    expect(biRows([a]).find((r) => r.media === 'facebook_web')?.spend).toBe(7);
  });
  test('product totals combine channels while channel rows keep them separate', () => {
    const report = day();
    report.level = 'products';
    report.daily.rows.push({
      ...report.daily.rows[0],
      media_source: 'facebook_web',
      spend: 7,
    });
    report.revenue.rows.push({
      ...report.revenue.rows[0],
      media_source: 'facebook_web',
      metric_value: 3,
    });
    expect(biRows([report])).toMatchObject([
      { media: '全部渠道', spend: 17, revenue: 8 },
    ]);
    report.level = 'channels';
    expect(biRows([report]).map((row) => [row.media, row.spend])).toEqual([
      ['facebook', 10],
      ['facebook_web', 7],
    ]);
  });
  test('selected dimensions form one combined grouping, not separate reports', () => {
    const report = day();
    report.level = 'products';
    report.levels = ['products', 'channels'];
    report.daily.rows.push({
      ...report.daily.rows[0],
      media_source: 'facebook_web',
      spend: 7,
    });
    report.revenue.rows.push({
      ...report.revenue.rows[0],
      media_source: 'facebook_web',
      metric_value: 3,
    });
    const rows = biRows([report]);
    expect(rows.map((row) => [row.label, row.spend, row.revenue])).toEqual([
      ['WingsLite(Android) / facebook', 10, 5],
      ['WingsLite(Android) / facebook_web', 7, 3],
    ]);
  });
  test('all-product channel view groups the same channel across products', () => {
    const report = day();
    report.level = 'channels';
    report.daily.rows.push({
      ...report.daily.rows[0],
      app_id: 12,
      app_name: 'Another App',
      spend: 7,
    });
    report.revenue.rows.push({
      ...report.revenue.rows[0],
      app_id: 12,
      app_name: 'Another App',
      metric_value: 3,
    });
    expect(biRows([report])).toMatchObject([
      {
        appId: 0,
        appName: '全部产品',
        media: 'facebook',
        spend: 17,
        revenue: 8,
      },
    ]);
    report.scopeAppId = 11;
    report.daily.rows.pop();
    report.revenue.rows.pop();
    expect(biRows([report])[0]).toMatchObject({ appId: 11, spend: 10 });
  });
  test('rejects malformed dates and unsupported dimensions', () => {
    expect(
      biQueryLevels({
        date: '2026-09-19',
        level: 'products',
        levels: 'products,channels,countries',
      }),
    ).toEqual(['products', 'channels', 'countries']);
    expect(() =>
      validateBiQuery({
        date: '2026-09-19',
        level: 'products',
        levels: 'products,invalid',
      }),
    ).toThrow('查看维度无效');
    expect(() =>
      validateBiQuery({
        date: '2026-09-19',
        level: 'products',
        levels: 'products,products',
      }),
    ).toThrow('查看维度无效');
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
    const q = {
      date: '2026-09-19',
      level: 'overall' as const,
      appId: '11',
      media: 'facebook',
    };
    expect((await s.day(q)).daily.state).toBe('fresh');
    expect((await s.day(q)).daily.state).toBe('cached');
    query.mockRejectedValue(new Error('connection unavailable'));
    expect((await s.day({ ...q, refresh: '1' })).daily.state).toBe('stale');
  });
  test('opening product options does not query Doris', async () => {
    const query = jest.fn();
    expect(await service(query).productOptions()).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
  test('product options use cached discovery and expose Web without a new Doris query', async () => {
    const query = jest.fn();
    const s = service(query);
    jest.spyOn(s, 'part').mockResolvedValue({
      state: 'cached',
      rows: [{ ...dimension, spend: 40 }],
    });
    expect((await s.productOptions()).map((p) => p.channel)).toEqual([
      'facebook',
      'facebook_web',
    ]);
    expect(query).not.toHaveBeenCalled();
  });
  test('combined levels request all selected grouping dimensions', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const result = await service(query).day({
      date: '2026-09-19',
      level: 'products',
      levels: 'products,channels,countries',
    });
    expect(result.levels).toEqual(['products', 'channels', 'countries']);
    expect(
      query.mock.calls.some(
        ([args]) =>
          (args.dimensions as string[]).includes('country_code') &&
          (args.dimensions as string[]).includes('media_source') &&
          (args.dimensions as string[]).includes('app_id'),
      ),
    ).toBe(true);
  });
  test('adjustment channel breakdown reuses the BI daily cache without cohort queries', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const s = service(query);
    const date = '2026-09-19';
    await s.day({ date, level: 'channels', appId: '11' });
    query.mockClear();
    const part = await s.channelSpend(date, '11');
    expect(part.state).toBe('cached');
    expect(query).not.toHaveBeenCalled();
    expect(() => s.channelSpend(date, '')).toThrow('请先选择产品');
  });
  test('W2A campaign names split Facebook spend and D0 even when Doris labels both Facebook', async () => {
    const s = service(jest.fn());
    const read = jest.spyOn(s, 'part').mockImplementation(async (args) => {
      const revenue =
        args.dataset === 'bi_ads.ads_paid_acquisition_cohort_metric';
      return {
        state: 'fresh',
        rows: [
          {
            ...dimension,
            campaign_id: '1',
            campaign_name: 'regular_install',
            ...(revenue ? { metric_value: 5 } : { spend: 10 }),
          },
          {
            ...dimension,
            campaign_id: '2',
            campaign_name: revenue ? 'previous_name' : 'launch_W2A_purchase',
            ...(revenue ? { metric_value: 8 } : { spend: 20 }),
          },
        ],
      };
    });
    const date = '2026-09-19';
    const web = await s.day({
      date,
      level: 'channels',
      appId: '11',
      media: 'facebook_web',
    });
    expect(web.daily.rows.map((row) => row.campaign_id)).toEqual(['2']);
    expect(web.revenue.rows.map((row) => row.campaign_id)).toEqual(['2']);
    expect(biRows([web])[0]).toMatchObject({
      media: 'facebook_web',
      spend: 20,
      revenue: 8,
    });
    const facebook = await s.day({
      date,
      level: 'channels',
      appId: '11',
      media: 'facebook',
    });
    expect(biRows([facebook])[0]).toMatchObject({
      media: 'facebook',
      spend: 10,
      revenue: 5,
    });
    expect(
      read.mock.calls.every(
        ([args]) =>
          (args.dimensions as string[]).includes('campaign_name') &&
          !Object.hasOwn(JSON.parse(String(args.filters_json)), 'media_source'),
      ),
    ).toBe(true);
  });
  test('product discovery exposes a Web option without inventing W2A spend', async () => {
    const s = service(jest.fn());
    jest.spyOn(s, 'part').mockResolvedValue({
      state: 'fresh',
      rows: [{ ...dimension, spend: 40 }],
    });
    const products = await s.products();
    expect(products.map((p) => [p.channel, p.spend])).toEqual([
      ['facebook', 40],
      ['facebook_web', 0],
    ]);
  });
  test('live BI never filters out unfinished D0 and expires cache after five minutes', async () => {
    const query = jest.fn(async (args: Record<string, unknown>) => {
      expect(JSON.parse(String(args.filters_json))).not.toHaveProperty(
        'observation_complete',
      );
      return { rows: [] };
    });
    const s = service(query);
    const q = {
      date: '2026-09-20',
      level: 'overall' as const,
      appId: '11',
      media: 'facebook',
    };
    await s.day({ date: q.date, level: 'channels' });
    expect(
      query.mock.calls.every(
        ([args]) =>
          !Object.hasOwn(JSON.parse(String(args.filters_json)), 'app_id'),
      ),
    ).toBe(true);
    query.mockClear();
    await s.day({ date: q.date, level: 'channels', appId: '11' });
    expect(
      query.mock.calls.every(
        ([args]) =>
          !Object.hasOwn(JSON.parse(String(args.filters_json)), 'media_source'),
      ),
    ).toBe(true);
    query.mockClear();
    await s.day(q);
    const calls = query.mock.calls.length;
    await s.day(q);
    expect(query.mock.calls.length).toBe(calls);
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 301000);
    try {
      expect((await s.day(q)).daily.state).toBe('fresh');
      expect(query.mock.calls.length).toBeGreaterThan(calls);
    } finally {
      clock.mockRestore();
    }
  });
  test('cache retains more than 1500 entries for 90 days and prunes only expired BI data', () => {
    const products = db.listProducts();
    for (let i = 0; i < 1502; i++)
      db.saveBiCache(
        `bounded-${i}`,
        JSON.stringify({
          rows: [],
          updatedAt: new Date(
            Date.now() - 89 * 86400000 + i * 1000,
          ).toISOString(),
        }),
      );
    db.saveBiCache(
      'expired',
      JSON.stringify({
        rows: [],
        updatedAt: new Date(Date.now() - 91 * 86400000).toISOString(),
      }),
    );
    expect(db.getBiCache('expired')).toBeUndefined();
    expect(db.getBiCache('bounded-0')).toBeDefined();
    expect(db.getBiCache('bounded-1501')).toBeDefined();
    expect(db.listProducts()).toEqual(products);
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
    expect(product.metrics.some((m) => m.key === product.targetMetric)).toBe(
      true,
    );
    expect(product.campaignRules?.length || 0).toBe(0);
    expect(
      product.metrics.every(
        (m) => m.lowerBound === undefined && m.upperBound === undefined,
      ),
    ).toBe(true);
  });
});
