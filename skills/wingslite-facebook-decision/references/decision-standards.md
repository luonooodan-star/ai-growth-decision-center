# Wingslite Facebook decision standards

This file is the authoritative, versioned ruleset for Wingslite. `null` means
the product owner has not approved the number yet. Do not infer or fabricate it.

```yaml
ruleset:
  product: 'Wingslite'
  doris_app_name: 'WingsLite(Android)'
  version: 'v0.1.0'
  status: 'calibration_required'

scope:
  channel: 'facebook'
  markets: ['IN', 'PK']
  platform: 'android'
  active_account_ids:
    - '2540310543056369'
    - '1488251649657730'
    - '1733669357668273'
    - '912419838148429'
    - '4559331474385863'
    - '1633581281710424'
  excluded_product_names: ['WingsAI']

sources:
  delivery: 'bi_ads.ads_paid_acquisition_daily'
  cohort_revenue: 'bi_ads.ads_paid_acquisition_cohort_metric'
  facebook_campaign: 'bi_dwd.dwd_facebook_campaign_daily'
  facebook_adset: 'bi_dwd.dwd_facebook_adgroup_daily'
  facebook_ad: 'bi_dwd.dwd_facebook_ad_daily'
  expected_delay_minutes: 60
  stale_after_minutes: 120
  cohort_maturity_hours: 72

product_line_standard:
  primary_metric: 'd0_roas'
  target_value: null
  minimum_acceptable_value: null
  stretch_value: null
  evaluation_currency: 'USD'
  guard_metrics:
    spend_plan_daily: null
    maximum_cpi: null
    minimum_adjust_installs: null
    minimum_ctr: null
    minimum_ipm: null

sample_gates:
  minimum_spend: null
  minimum_installs: null
  minimum_mature_cohorts: null
  consecutive_windows: null
  comparison: 'matched weekday and hour over the previous 7 mature days'

anomaly_thresholds:
  d0_roas_deviation_pct: null
  cpi_deviation_pct: null
  ctr_deviation_pct: null
  ipm_deviation_pct: null
  spend_deviation_pct: null

increase_standard:
  enabled: false
  trigger_roas_multiple_of_target: null
  required_consecutive_windows: null
  minimum_spend: null
  minimum_installs: null
  maximum_budget_increase_pct_per_step: null
  cooldown_hours: null
  required_guards:
    - 'data is fresh and cohorts are mature'
    - 'D0 ROAS meets the approved increase trigger'
    - 'CPI, CTR and IPM guard metrics are healthy'
    - 'no overlapping budget experiment is running'
  fallback_until_calibrated: 'hold budget and request product-owner calibration'

decrease_standard:
  enabled: false
  trigger_roas_multiple_of_floor: null
  required_consecutive_windows: null
  minimum_spend: null
  maximum_budget_decrease_pct_per_step: null
  cooldown_hours: null
  required_guards:
    - 'data is fresh and cohorts are mature'
    - 'underperformance is not explained by reporting delay'
    - 'the diagnosis identifies a controllable advertising cause'
  fallback_until_calibrated: 'recommend hold or investigation; do not calculate a budget cut'

stop_standard:
  enabled: false
  spend_loss_limit: null
  severe_roas_floor: null
  required_consecutive_windows: null
  fallback_until_calibrated: 'human escalation only'

execution:
  requires_human_approval: true
  prohibited_evidence:
    - 'Meta Purchase count or purchase ROAS until event mapping is validated'
  prohibited_actions:
    - 'merge WingsAI into Wingslite'
    - 'apply an unconfigured percentage increase or decrease'
```

## Facebook and Doris diagnostic tree

Use the following order after data-readiness gates pass:

1. `spend` changed materially:
   inspect campaign/ad-set status, budget, bid, schedule, audience size, auction
   pressure, and delivery limits.
2. `CTR` or `IPM` deteriorated while delivery remained stable:
   investigate creative fatigue, hook quality, placement mix, and audience fit.
3. `CTR` stayed stable but `CPI` rose:
   investigate auction cost, landing/store conversion, geo mix, and tracking.
4. `CPI` stayed stable but mature `D0 ROAS` fell:
   investigate install quality, activation/payment funnels, cohort revenue, and
   product/backend events before changing Facebook budgets.
5. Meta Purchase and Doris revenue disagree:
   create a data-quality judgment and use mature Doris revenue as the decision
   source until event mapping is validated.

## Judgment outcomes

- `confirmed`: evidence and sample gates support the stated anomaly/cause.
  A separate adjustment recommendation may now be created.
- `deferred`: data is immature, incomplete, conflicting, or below sample gates.
  Set the next review window and missing evidence.
- `rejected`: the anomaly/cause is not supported. Record why, and create a
  false-positive suppression candidate when the pattern can recur.

Judgment outcomes are learning events, not recommendations. Never include them
in recommendation adoption or improvement rates.

## Adjustment mapping

- Data-quality cause: investigate/fix data; no budget action.
- Creative cause: rotate or test creative at the affected ad level; protect a
  control and define rollback guards.
- Audience cause: isolate or test the affected ad set; do not change unrelated
  campaigns.
- Auction/delivery cause: adjust only the affected level after the configured
  increase/decrease gate is approved and satisfied.
- Product conversion/revenue cause: notify the product owner; keep Facebook
  budget unchanged unless a separate approved risk limit is breached.

## Calibration checklist

Before enabling automatic numeric recommendations, the product owner must fill
and approve:

1. D0 ROAS target, minimum acceptable value, and stretch value.
2. Minimum spend/installs/cohort sample gates and consecutive windows.
3. Increase trigger, step percentage, and cooldown.
4. Decrease trigger, step percentage, and cooldown.
5. Stop-loss limit and severe underperformance rule.
6. Guard metric thresholds for CPI, CTR, IPM, and spend plan.

Each approval must record `approved_by`, `approved_at`, supporting evidence, and
the resulting Skill version.
