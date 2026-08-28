# Wingslite Doris query contract

This contract records the read-only Doris mapping verified on 2026-08-28. It
defines how the Agent reads Wingslite data; it does not grant permission to
change campaigns or budgets.

## Required filters

Apply all of the following to every performance query:

```yaml
app_name: 'WingsLite(Android)'
media_source: 'facebook'
country_code: ['IN', 'PK']
```

`media_source` is case-sensitive in the current data and must be lowercase.
Exclude `WingsAI`. Do not add `buyer_alias` or `producer_alias` filters unless
the user explicitly asks to restrict the analysis to a person.

## Dataset mapping

| Purpose | Dataset | Date field | Required metrics |
| --- | --- | --- | --- |
| Delivery and same-day outcome | `bi_ads.ads_paid_acquisition_daily` | `report_date` | `spend`, `impressions`, `media_clicks`, `media_installs`, `adjust_installs`, `adjust_revenue`, `cpi`, `ctr`, `ipm`, `roas` |
| Mature product outcome | `bi_ads.ads_paid_acquisition_cohort_metric` | cohort date | `cohort_spend`, `metric_value`, `cumulative_metric_value`, `d0_roas`, `d7_roas`, `d30_roas`, `cohort_roas` |
| Campaign diagnosis | `bi_dwd.dwd_facebook_campaign_daily` | `report_date` | delivery metrics available to the role |
| Ad-set diagnosis | `bi_dwd.dwd_facebook_adgroup_daily` | `report_date` | delivery metrics available to the role |
| Ad and creative diagnosis | `bi_dwd.dwd_facebook_ad_daily` | `report_date` | delivery metrics available to the role |

## Hourly read sequence

1. Find the latest complete delivery date and record the source update time.
2. Query product/market totals before drilling into Campaign, Ad Set, Ad, or
   Creative. Compare only like-for-like windows.
3. Query mature cohort D0 ROAS with `cohort_index = 0` and
   `observation_complete = true` before judging the product outcome.
4. If a leading metric moves, resolve the affected entity and preserve its ID
   and name in the judgment record.
5. If the latest data is older than 120 minutes or cohort maturity is not met,
   create a data-quality/deferred judgment instead of a performance judgment.
6. Send the structured result to
   `POST /openapi/growth-decision/judgments`. Do not create a recommendation at
   this stage.

## Verified smoke test

The first read-only smoke test returned eight daily rows for Campaign
`52568942691300` from 2026-08-20 through 2026-08-27, with spend, impressions,
clicks, installs, revenue, CPI, CTR, IPM, and ROAS. This proves product-to-
Campaign traceability. It is connection evidence, not a validated decision
rule or an approved product threshold.

## Write boundary

Doris remains read-only. The application stores judgments, human outcomes,
recommendations, and experiment results in its own database. Only a confirmed
judgment may be used to create a recommendation, and a recommendation still
requires separate human approval before any advertising action.
