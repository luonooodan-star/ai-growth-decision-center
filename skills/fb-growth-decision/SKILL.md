---
name: fb-growth-decision
description: Analyze Facebook advertising and product-backend metrics to detect growth anomalies, explain likely causes, produce traceable actions, and evaluate accepted recommendations. Use for hourly growth reviews, decision suggestions, experiment follow-up, and weekly Skill iteration. Do not use to execute material budget changes without explicit approval.
---

# Facebook Growth Decision

Turn advertising anomalies into reviewable decisions and reusable evidence.

## Required context

Before analyzing a product, load its product profile. If none exists, create one
from [the product profile template](references/product-profile-template.md) and
leave unknown thresholds unset rather than inventing them.

Use both Facebook delivery data and product-backend outcomes. Preserve original
account, campaign, ad set, audience, ad, and creative IDs in every finding.

## Decision workflow

1. Check data freshness and completeness. Treat data newer than the configured
   maturity window as provisional. Do not report a business anomaly when the
   more likely explanation is delayed or incomplete data.
2. Compare the current window with the product profile's baseline and minimum
   sample requirements. Require both a material deviation and sufficient
   business impact before escalating.
3. Diagnose through the metric tree. Separate confirmed facts, likely causes,
   hypotheses requiring validation, and missing evidence.
4. Produce one recommendation per independently executable action. Include the
   target IDs, evidence, confidence, expected impact, observation window, guard
   metrics, risk, and rollback condition.
5. Send the recommendation for human review. Record accepted, rejected, or
   deferred status and the user's reason. Do not execute an advertising change
   unless the user has explicitly authorized that exact class of change.
6. For accepted recommendations, define the baseline and comparison method
   before observing the result. Prefer a concurrent control, then a comparable
   campaign, then matched weekday/time, and use a simple before/after comparison
   only when stronger controls are unavailable.
7. Classify mature experiments as expected, partial, neutral, or negative. Keep
   inconclusive experiments separate from failures.

## Weekly learning

Keep raw experiment facts immutable. A single result may create a candidate
lesson, but it must not become a formal rule automatically. Promote a lesson to
the product profile only after repeated evidence or explicit human approval.
Record the Skill version and the experiment IDs behind each promoted rule.

Calculate recommendation success rate only from accepted, executed experiments
whose observation windows have ended and whose samples are mature.

## Output contract

Return structured data compatible with the application's
`IngestDecisionCaseRequest` interface. Do not omit traceability fields merely
because a platform object has a readable name. When an ID is unavailable, mark
it as missing evidence rather than fabricating one.
