import {
  adjustmentDates,
  adjustmentMatches,
  adjustmentTree,
  adjustmentSignal,
  adjustmentTotal,
  adjustmentReportedTotal,
  withAdjustmentDetails,
} from '@shared/ad-adjustment';
import type {
  AdjustmentDay,
  AdjustmentFilters,
} from '@shared/ad-adjustment.interface';
import { ADJUSTMENT_REFRESH_MS } from '@shared/ad-adjustment.interface';
import { AdAdjustmentService } from '@server/modules/growth-decision/ad-adjustment.service';
import { PaidGrowthService } from '@server/modules/growth-decision/paid-growth.service';
import type { BiRawRow } from '@shared/paid-growth.interface';

const filters: AdjustmentFilters = {
  search: '',
  account: '',
  optimizer: '',
  country: '',
};
const raw: BiRawRow = {
  app_id: 11,
  app_name: 'App',
  media_source: 'facebook',
  campaign_id: 'c1',
  campaign_name: 'Campaign One',
  adgroup_id: 'g1',
  adgroup_name: 'Group',
  creative_id: 'a1',
  creative_name: 'Creative',
  buyer_alias: 'alice',
  country_code: 'IN',
  spend: 10,
  impressions: 1000,
  media_clicks: 100,
  media_installs: 20,
};
const day = (date = '2026-09-21'): AdjustmentDay => ({
  date,
  daily: { state: 'fresh', rows: [{ ...raw }] },
  revenue: { state: 'fresh', rows: [{ ...raw, metric_value: 15 }] },
  accounts: {
    state: 'fresh',
    rows: [
      {
        app_id: 11,
        campaign_id: 'c1',
        country_code: 'IN',
        advertiser_id: 'account1',
      },
    ],
  },
});
describe('advertising adjustment workbench', () => {
  test('overview totals returned revenue without replacing missing entity values', () => {
    const d = day();
    const m = adjustmentTree([d], filters, d.date)[0].days[d.date];
    const missing = { ...m, revenue: null, roas: null };
    expect(adjustmentReportedTotal([m, missing]).revenue).toBe(15);
    expect(adjustmentReportedTotal([missing]).revenue).toBeNull();
    expect(missing.revenue).toBeNull();
  });
  test('four-hour cache expires at the boundary and manual refresh bypasses it', async () => {
    const stamp = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(stamp);
    const database = {
      getBiCache: jest.fn().mockReturnValue(
        JSON.stringify({
          rows: [],
          state: 'fresh',
          updatedAt: new Date(stamp).toISOString(),
        }),
      ),
      saveBiCache: jest.fn(),
    };
    const fetcher = {
      queryMetric: jest.fn().mockRejectedValue(new Error('test unavailable')),
    };
    const service = new PaidGrowthService(
      database as never,
      fetcher as never,
      {} as never,
    );
    try {
      clock.mockReturnValue(stamp + ADJUSTMENT_REFRESH_MS - 1);
      expect(
        (await service.part({}, false, ADJUSTMENT_REFRESH_MS, 'adjustment-v1:'))
          .state,
      ).toBe('cached');
      expect(fetcher.queryMetric).not.toHaveBeenCalled();
      clock.mockReturnValue(stamp + ADJUSTMENT_REFRESH_MS);
      expect(
        (await service.part({}, false, ADJUSTMENT_REFRESH_MS, 'adjustment-v1:'))
          .state,
      ).toBe('stale');
      expect(fetcher.queryMetric).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(stamp);
      await service.part({}, true, ADJUSTMENT_REFRESH_MS, 'adjustment-v1:');
      expect(fetcher.queryMetric).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });
  test('all four selectors are AND and can each be used alone', () => {
    expect(
      adjustmentMatches(
        raw,
        {
          ...filters,
          search: 'ONE',
          account: 'account1',
          optimizer: 'alice',
          country: 'IN',
        },
        'account1',
      ),
    ).toBe(true);
    for (const f of [
      { search: 'c2' },
      { account: 'account2' },
      { optimizer: 'bob' },
      { country: 'PK' },
    ])
      expect(adjustmentMatches(raw, { ...filters, ...f }, 'account1')).toBe(
        false,
      );
    for (const f of [
      { search: 'c1' },
      { account: 'account1' },
      { optimizer: 'alice' },
      { country: 'IN' },
    ])
      expect(adjustmentMatches(raw, { ...filters, ...f }, 'account1')).toBe(
        true,
      );
  });
  test('country and optimizer intersections reaggregate all levels, not campaign totals', () => {
    const d = day();
    d.daily.rows.push({
      ...raw,
      country_code: 'PK',
      buyer_alias: 'bob',
      spend: 90,
      media_clicks: 300,
      media_installs: 30,
    });
    d.revenue.rows.push({
      ...raw,
      country_code: 'PK',
      buyer_alias: 'bob',
      metric_value: 5,
    });
    const all = adjustmentTree([d], filters, d.date)[0];
    expect(all.days[d.date].spend).toBe(100);
    expect(all.days[d.date].roas).toBe(20);
    expect(all.days[d.date].cvr).toBe(12.5);
    expect(all.children[0].children[0].days[d.date].spend).toBe(100);
    const scoped = adjustmentTree(
      [d],
      { ...filters, country: 'IN', optimizer: 'alice' },
      d.date,
    )[0];
    expect(scoped.days[d.date].roas).toBe(150);
    expect(scoped.days[d.date].cpi).toBe(0.5);
    expect(
      adjustmentTree(
        [d],
        { ...filters, country: 'PK', optimizer: 'alice' },
        d.date,
      ),
    ).toHaveLength(0);
  });
  test('renames join by stable IDs and D0 dates remain independent', () => {
    const today = day(),
      previous = day('2026-09-20');
    previous.daily.rows[0].campaign_name = 'Old name';
    previous.daily.rows[0].spend = 20;
    const root = adjustmentTree([previous, today], filters, today.date)[0];
    expect(root.name).toBe('Campaign One');
    expect(root.days['2026-09-20'].roas).toBe(75);
    expect(root.days[today.date].roas).toBe(150);
    expect(adjustmentDates('2026-03-01')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
  });
  test('same creative in two adgroups is never merged across parents', () => {
    const d = day();
    d.daily.rows.push({ ...raw, adgroup_id: 'g2' });
    d.revenue.rows.push({ ...raw, adgroup_id: 'g2', metric_value: 30 });
    const root = adjustmentTree([d], filters, d.date)[0];
    expect(root.children).toHaveLength(2);
    expect(root.days[d.date].revenue).toBe(45);
    expect(root.children.map((n) => n.days[d.date].roas).sort()).toEqual([
      150, 300,
    ]);
    expect(adjustmentTotal(root.children.map((n) => n.days[d.date])).roas).toBe(
      225,
    );
  });
  test('missing revenue and unknown account are not guessed; historical-only campaigns are excluded', () => {
    const d = day();
    d.accounts.rows = [];
    d.revenue.rows = [];
    const old = day('2026-09-20');
    old.daily.rows[0].campaign_id = 'old';
    old.revenue.rows = [];
    const roots = adjustmentTree([d, old], filters, d.date);
    expect(roots).toHaveLength(1);
    expect(roots[0].days[d.date].roas).toBeNull();
    const isolated = adjustmentTree([d], filters, d.date)[0];
    expect(isolated.account).toBe('未返回');
    expect(adjustmentSignal(isolated, d.date, []).state).toBe('unknown');
  });
  test('conflicting account mappings stay unassigned and stale data cannot pass targets', () => {
    const d = day();
    d.accounts.rows.push({ ...d.accounts.rows[0], advertiser_id: 'account2' });
    d.daily.state = 'stale';
    const root = adjustmentTree([d], filters, d.date)[0];
    expect(root.account).toBe('归属待确认');
    expect(
      adjustmentTree([d], { ...filters, account: 'account1' }, d.date),
    ).toHaveLength(0);
    expect(adjustmentSignal(root, d.date, []).label).toContain('过期');
  });
  test('service defaults to light summary, preserves AND dimensions and caches history', async () => {
    const bi = {
      part: jest.fn().mockResolvedValue({ rows: [], state: 'fresh' }),
    };
    const service = new AdAdjustmentService(bi as unknown as PaidGrowthService);
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
    await service.day({
      date: today,
      appId: '11',
      media: 'facebook',
      refresh: '1',
    });
    expect(bi.part).toHaveBeenCalledTimes(3);
    for (const call of bi.part.mock.calls)
      expect(call.slice(1)).toEqual([
        true,
        ADJUSTMENT_REFRESH_MS,
        'adjustment-v2:',
      ]);
    const args = bi.part.mock.calls[1][0];
    expect(args.dimensions).toEqual(
      expect.arrayContaining(['buyer_alias', 'country_code']),
    );
    expect(args.dimensions).not.toContain('creative_id');
    expect(args.dimensions).not.toContain('adgroup_id');
    expect(JSON.parse(args.filters_json)).toEqual({
      app_id: 11,
      media_source: 'facebook',
      cohort_index: 0,
      cohort_unit: 'D',
      metric_id: 'revenue',
    });
    await expect(service.day({ date: '2000-01-01' })).rejects.toThrow('前两天');
    bi.part.mockClear();
    await service.day({
      date: adjustmentDates(today)[0],
      appId: '11',
      media: 'facebook',
      refresh: '1',
    });
    expect(bi.part.mock.calls.every((call) => call[1] === false)).toBe(true);
    bi.part.mockClear();
    await service.day({
      date: today,
      appId: '11',
      media: 'facebook',
      campaignId: '123',
      refresh: '1',
    });
    expect(bi.part.mock.calls[0][0].dimensions).toContain('creative_id');
    expect(JSON.parse(bi.part.mock.calls[0][0].filters_json).campaign_id).toBe(
      '123',
    );
    expect(bi.part.mock.calls[2][1]).toBe(false); // reuse account map
    await expect(
      service.day({
        date: today,
        appId: '11',
        media: 'facebook',
        campaignId: 'x',
      }),
    ).rejects.toThrow('ID');
  });
  test('lazy children never double count summary totals and preserve AND filters', () => {
    const d = day();
    const summary = { ...d, granularity: 'campaign' as const };
    const roots = adjustmentTree([summary], filters, d.date);
    expect(roots[0].children).toHaveLength(0);
    const attached = withAdjustmentDetails(roots, { c1: [d] }, filters, d.date);
    expect(attached[0].days[d.date].spend).toBe(10);
    expect(attached[0].days[d.date].revenue).toBe(15);
    expect(attached[0].children[0].children[0].days[d.date].spend).toBe(10);
    expect(
      withAdjustmentDetails(
        roots,
        { c1: [d] },
        { ...filters, country: 'PK' },
        d.date,
      )[0].children,
    ).toHaveLength(0);
  });
  test('limits concurrent parts to three and coalesces identical inflight requests', async () => {
    let active = 0,
      peak = 0;
    const bi = {
      part: jest.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { rows: [], state: 'fresh' };
      }),
    };
    const service = new AdAdjustmentService(bi as unknown as PaidGrowthService);
    const q = {
      date: new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Shanghai',
      }),
      appId: '11',
      media: 'facebook',
    };
    await Promise.all([service.day(q), service.day(q)]);
    expect(bi.part).toHaveBeenCalledTimes(3);
    await Promise.all(
      ['1', '2', '3', '4'].map((campaignId) =>
        service.day({ ...q, campaignId }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(active).toBe(0);
  });
});
