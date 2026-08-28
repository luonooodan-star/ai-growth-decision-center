---
name: fb-growth-decision
description: "Analyze Facebook advertising and product-backend metrics through a two-stage workflow: validate anomalies and causes first, then create traceable adjustment recommendations only after human confirmation. Use for hourly growth reviews, judgment review, experiment follow-up, and weekly Skill iteration. Do not use to execute material budget changes without explicit approval."
---

# Facebook Growth Decision

Turn advertising anomalies into reviewable decisions and reusable evidence.

## Required context

Before analyzing a product, load its product profile. If none exists, create one
from [the product profile template](references/product-profile-template.md) and
leave unknown thresholds unset rather than inventing them.

This Skill is the cross-product workflow. For Wingslite, use the dedicated
`wingslite-facebook-decision` Skill, whose product-line standards are
authoritative. Do not maintain a second Wingslite ruleset here.

Use both Facebook delivery data and product-backend outcomes. Preserve original
account, campaign, ad set, audience, ad, and creative IDs in every finding.

## Judgment workflow

1. Check data freshness and completeness. Treat data newer than the configured
   maturity window as provisional. Do not report a business anomaly when the
   more likely explanation is delayed or incomplete data.
2. Compare the current window with the product profile's baseline and minimum
   sample requirements. Require both a material deviation and sufficient
   business impact before escalating.
3. Diagnose through the metric tree. Separate confirmed facts, likely causes,
   hypotheses requiring validation, and missing evidence. Produce a preliminary
   judgment with its confidence and, when useful, one candidate Skill rule.
4. Send the judgment for human review. Record exactly one outcome:
   `confirmed`, `deferred`, or `rejected`, together with the review reason.
   A deferred judgment remains open for more data. A rejected judgment remains
   immutable evidence for improving future detection.
5. Do not generate an adjustment recommendation until the judgment is
   confirmed. Judgment outcomes are learning data and must never enter the
   recommendation adoption-rate numerator or denominator.

## Recommendation workflow

1. For a confirmed judgment, produce one recommendation per independently
   executable action. Include the
   target IDs, evidence, confidence, expected impact, observation window, guard
   metrics, risk, and rollback condition.
2. Send the recommendation for human review. Record accepted, rejected, or
   deferred status and the user's reason. Do not execute an advertising change
   unless the user has explicitly authorized that exact class of change.
3. For accepted recommendations, define the baseline and comparison method
   before observing the result. Prefer a concurrent control, then a comparable
   campaign, then matched weekday/time, and use a simple before/after comparison
   only when stronger controls are unavailable.
4. Classify mature experiments as expected, partial, neutral, or negative. Keep
   inconclusive experiments separate from failures.

## Weekly learning

Keep raw judgment and experiment facts immutable. Confirmed and rejected
judgments may create candidate lessons; rejected judgments are especially useful
for suppressing false-positive patterns. A single result must not become a
formal rule automatically. Promote a lesson to the product profile only after
repeated evidence or explicit human approval. Record the Skill version and the
judgment or experiment IDs behind each promoted rule.

Calculate recommendation success rate only from accepted, executed experiments
whose observation windows have ended and whose samples are mature.

## Output contract

For the first stage, return structured data compatible with
`IngestJudgmentRequest`. After a human confirms that judgment, return adjustment
data compatible with `CreateRecommendationFromJudgmentRequest`. Do not skip the
judgment stage or use the legacy combined request for new analyses. Do not omit
traceability fields merely because a platform object has a readable name. When
an ID is unavailable, mark it as missing evidence rather than fabricating one.
