import type { GrowthFetchRun } from '@shared/api.interface';

/** A failed optional ad breakdown must not quarantine validated campaign delivery. */
export function campaignFetchQuality(
  gaps: NonNullable<GrowthFetchRun['gaps']>,
) {
  const delivery = new Set(
    gaps
      .filter((g) => g.dataset === 'bi_ads.ads_paid_acquisition_daily')
      .map((g) => g.dataDate),
  );
  const cohort = new Set(
    gaps
      .filter((g) => g.dataset === 'bi_ads.ads_paid_acquisition_cohort_metric')
      .map((g) => g.dataDate),
  );
  return { delivery, cohort, primary: new Set([...delivery, ...cohort]) };
}
