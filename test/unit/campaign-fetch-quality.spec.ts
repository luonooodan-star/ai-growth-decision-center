import { campaignFetchQuality } from '@server/modules/growth-decision/campaign-fetch-quality';
test('optional ad dimension errors do not quarantine validated campaign acquisition', () => {
  const q = campaignFetchQuality([
    {
      dataset: 'bi_dwd.dwd_facebook_ad_daily',
      dataDate: '2026-09-21',
      message: 'timeout',
    },
  ]);
  expect(q.primary.size).toBe(0);
});
test('cohort and acquisition failures stay separate and block decision publication', () => {
  const q = campaignFetchQuality([
    {
      dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
      dataDate: '2026-09-21',
      message: 'bad totals',
    },
  ]);
  expect(q.delivery.size).toBe(0);
  expect(q.cohort.has('2026-09-21')).toBe(true);
  expect(q.primary.size).toBe(1);
});
