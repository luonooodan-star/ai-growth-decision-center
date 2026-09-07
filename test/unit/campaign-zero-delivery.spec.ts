import type {
  CampaignDailySnapshot,
  GrowthProduct,
} from '@shared/api.interface';
import { buildCampaignCard } from '@server/modules/growth-decision/campaign-decision-engine';

const now = new Date('2026-09-07T11:00:00Z');
const product = {
  targetMetric: 'd0_roas',
  dataDelayMinutes: 60,
  metrics: [{ key: 'd0_roas', lowerBound: 0.7 }],
} as GrowthProduct;
const snapshot = (): CampaignDailySnapshot => ({
  key: 'series',
  campaignId: 'series',
  campaignName: 'series',
  productId: 'product',
  accountId: 'account',
  countries: ['IN'],
  dataDate: '2026-09-06',
  fetchedAt: now.toISOString(),
  qualityIssues: [],
  breakdowns: [],
  metrics: {
    spend: 0,
    impressions: 0,
    media_clicks: 0,
    media_installs: 0,
    adjust_installs: 0,
    adjust_revenue: 0.02,
  },
});
describe('zero delivery is not a missing target anomaly', () => {
  it('separates unresolved ownership from spend integrity while retaining action guardrails', () => {
    const days = ['2026-09-06', '2026-09-05'].map((dataDate) => ({
      ...snapshot(),
      dataDate,
      accountId: undefined,
      qualityIssues: ['广告账户归属尚未唯一确认'],
    }));
    const card = buildCampaignCard(product, days, [], now);
    expect(card.noRecentDelivery).toBe(true);
    expect(card.noDeliveryHideAfter).toBeDefined();
    expect(card.blockers).toContain('广告账户归属尚未唯一确认');
    expect(card.primaryAction.changePct).toBeUndefined();
    expect(
      buildCampaignCard(
        product,
        days.map((s) => ({
          ...s,
          qualityIssues: [...s.qualityIssues, '汇总不一致'],
        })),
        [],
        now,
      ).noRecentDelivery,
    ).toBe(false);
    expect(
      buildCampaignCard(
        product,
        days.map((s) => ({ ...s, metrics: { ...s.metrics, spend: 50 } })),
        [],
        now,
      ).noRecentDelivery,
    ).toBe(false);
  });
  it('classifies two consecutive zero-spend days even with earlier spend and attribution', () => {
    const days = ['2026-09-06', '2026-09-05', '2026-09-04'].map(
      (dataDate, i) => ({
        ...snapshot(),
        dataDate,
        metrics: {
          ...snapshot().metrics,
          spend: i === 2 ? 50 : 0,
          adjust_installs: 10,
        },
      }),
    );
    const card = buildCampaignCard(product, days, [], now);
    expect(card.noRecentDelivery).toBe(true);
    expect(card.noDeliveryHideAfter).toBe('2026-09-13T16:00:00.000Z');
    expect(card.reason).toContain('连续 2');
    const resumed = {
      ...snapshot(),
      dataDate: '2026-09-07',
      metrics: { ...snapshot().metrics, spend: 1 },
    };
    expect(
      buildCampaignCard(product, [...days, resumed], [], now).noRecentDelivery,
    ).toBe(false);
  });
  it('keeps a stable seven-day deadline without deleting source snapshots', () => {
    const days = Array.from({ length: 9 }, (_, i) => ({
      ...snapshot(),
      dataDate: `2026-${i < 6 ? '09' : '08'}-${String(i < 6 ? 6 - i : 37 - i).padStart(2, '0')}`,
    }));
    const card = buildCampaignCard(product, days, [], now);
    expect(card.noDeliveryHideAfter).toBe('2026-09-06T16:00:00.000Z');
    expect(Date.parse(card.noDeliveryHideAfter!)).toBeLessThan(now.getTime());
    expect(
      buildCampaignCard(
        product,
        days.map((s) => ({
          ...s,
          fetchedAt: new Date(now.getTime() + 3600000).toISOString(),
        })),
        [],
        new Date(now.getTime() + 3600000),
      ).noDeliveryHideAfter,
    ).toBe(card.noDeliveryHideAfter);
    expect(days).toHaveLength(9);
  });
  it('does not bridge missing days or use missing spend as zero', () => {
    const day = {
      ...snapshot(),
      metrics: {
        ...snapshot().metrics,
        adjust_installs: 10,
        media_installs: 1,
      },
    };
    expect(
      buildCampaignCard(
        product,
        [day, { ...day, dataDate: '2026-09-04' }],
        [],
        now,
      ).noRecentDelivery,
    ).toBe(false);
    expect(
      buildCampaignCard(
        product,
        [
          day,
          {
            ...day,
            dataDate: '2026-09-05',
            metrics: { ...day.metrics, spend: undefined },
          },
        ],
        [],
        now,
      ).noRecentDelivery,
    ).toBe(false);
  });
  it('does not mistake Adjust attribution installs for new media delivery', () => {
    const source = {
      ...snapshot(),
      metrics: {
        ...snapshot().metrics,
        adjust_installs: 2,
        cpi: 0,
        adjust_revenue: 0.395,
      },
    };
    const card = buildCampaignCard(product, [source], [], now);
    expect(card.noRecentDelivery).toBe(true);
    expect(card.snapshot.metrics.adjust_installs).toBe(2);
    expect(card.blockers.join()).not.toContain('主目标指标未返回');
  });
  it('separates residual revenue from acquisition activity', () => {
    const card = buildCampaignCard(product, [snapshot()], [], now);
    expect(card.noRecentDelivery).toBe(true);
    expect(card.reason).toContain('无新增投放');
    expect(card.blockers.join()).not.toContain('主目标指标未返回');
    expect(card.blockers.join()).not.toContain('样本不足');
    expect(card.primaryAction.changePct).toBeUndefined();
  });
  it.each([
    { spend: undefined },
    { impressions: undefined },
    { media_clicks: 1 },
    { spend: 1 },
    { media_installs: 1 },
  ])('does not hide missing or positive delivery: %j', (metrics) => {
    expect(
      buildCampaignCard(
        product,
        [{ ...snapshot(), metrics: { ...snapshot().metrics, ...metrics } }],
        [],
        now,
      ).noRecentDelivery,
    ).toBe(false);
  });
  it('keeps a series that resumed today visible', () => {
    const today = {
      ...snapshot(),
      dataDate: '2026-09-07',
      metrics: { ...snapshot().metrics, spend: 10 },
    };
    expect(
      buildCampaignCard(product, [snapshot(), today], [], now).noRecentDelivery,
    ).toBe(false);
  });
  it('keeps prior active days visible and explains absent yesterday without inventing zeros', () => {
    const older = {
      ...snapshot(),
      dataDate: '2026-09-05',
      metrics: { ...snapshot().metrics, spend: 20 },
    };
    const card = buildCampaignCard(product, [older], [], now);
    expect(card.noRecentDelivery).toBe(false);
    expect(card.blockers.join()).toContain('昨日 2026-09-06 无该系列快照');
    expect(card.trend).toHaveLength(1);
  });
  it('keeps fresh integrity failures visible but classifies stale history separately', () => {
    expect(
      buildCampaignCard(
        product,
        [{ ...snapshot(), qualityIssues: ['incomplete'] }],
        [],
        now,
      ).noRecentDelivery,
    ).toBe(false);
    expect(
      buildCampaignCard(
        product,
        [{ ...snapshot(), fetchedAt: '2026-09-06T01:00:00Z' }],
        [],
        now,
      ).noRecentDelivery,
    ).toBe(true);
  });
  it('archives stale positive-spend history without claiming zero and restores fresh spend', () => {
    const source = {
      ...snapshot(),
      fetchedAt: '2026-09-06T01:00:00Z',
      metrics: { ...snapshot().metrics, spend: 50 },
    };
    const card = buildCampaignCard(product, [source], [], now);
    expect(card.noRecentDelivery).toBe(true);
    expect(card.staleHistory).toBe(true);
    expect(card.reason).toContain('不代表实际消耗为零');
    expect(card.blockers).toContain('数据已过期，需要重新抓取');
    expect(card.noDeliveryHideAfter).toBe('2026-09-13T04:00:00.000Z');
    expect(
      buildCampaignCard(
        product,
        [{ ...source, fetchedAt: now.toISOString() }],
        [],
        now,
      ).noRecentDelivery,
    ).toBe(false);
  });
});
