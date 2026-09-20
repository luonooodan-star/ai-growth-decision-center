import type { CampaignDecisionCard, GrowthProduct } from '@shared/api.interface';
import { campaignDataHealth } from '@server/modules/growth-decision/campaign-data-health';

describe('campaign data health separates latency from failed ingestion', () => {
  const now = new Date('2026-09-20T08:00:00Z');
  const product = { channel: 'facebook', targetMetric: 'd0_roas', metrics: [{ key: 'd0_roas', availability: 'available' }] } as GrowthProduct;
  const card = (dataDate = '2026-09-19') => ({ snapshot: {
    accountId: '123', dataDate, qualityIssues: [], metrics: { spend: 40, adjust_installs: 120 },
  } }) as CampaignDecisionCard;
  it('waits for recent D0 but requires repair after the latency window', () => {
    expect(campaignDataHealth(card(), product, now).state).toBe('waiting');
    expect(campaignDataHealth(card('2026-09-17'), product, now).state).toBe('repair');
  });
  it('never hides an incomplete source behind attribution latency', () => {
    const c = card(); c.snapshot.qualityIssues = ['cohort 汇总校验失败'];
    expect(campaignDataHealth(c, product, now).state).toBe('repair');
  });
  it('does not demand a Facebook identity from Unity', () => {
    const c = card(); c.snapshot.accountId = undefined; c.snapshot.metrics.d0_roas = 0.8;
    expect(campaignDataHealth(c, { ...product, channel: 'unity' }, now).state).toBe('ready');
    expect(campaignDataHealth(c, product, now).state).toBe('repair');
  });
  it('distinguishes zero denominators and pending product configuration', () => {
    const c = card('2026-09-10'); c.snapshot.metrics.spend = 0;
    expect(campaignDataHealth(c, product, now).state).toBe('waiting');
    expect(campaignDataHealth(card(), { ...product, metrics: [] }, now).state).toBe('waiting');
  });
});
