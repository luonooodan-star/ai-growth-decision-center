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
  it('does not hide corrupt or stale zero snapshots', () => {
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
    ).toBe(false);
  });
});
