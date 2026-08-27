# Product profile template

Create one file per product. Keep unknown values empty until the owner confirms
them. Every rule change should include the date, approving owner, Skill version,
and supporting experiment IDs.

```yaml
product:
  name: ""
  owner: ""
  channel: "facebook"
  account_id: ""
  markets: []
  platforms: []

data:
  facebook_source: ""
  product_source: ""
  expected_delay_minutes: 60
  attribution_window: ""
  maturity_window_hours: 72

objective:
  primary_metric: "cpa"
  guard_metrics: []
  currency: "USD"

minimum_samples:
  spend: null
  conversions: null
  hours: 3

anomaly_thresholds:
  cpa_deviation_pct: null
  roas_deviation_pct: null
  ctr_deviation_pct: null
  spend_change_pct: null

execution_limits:
  max_budget_change_pct: null
  prohibited_actions: []
  requires_human_approval: true

validated_rules: []
candidate_lessons: []

skill_version: "v0.1.0"
```

## Validated rule fields

Each validated rule should contain:

- `rule_id`
- `condition`
- `recommended_action`
- `observation_window`
- `guard_metrics`
- `supporting_experiment_ids`
- `approved_by`
- `approved_at`
- `skill_version`
