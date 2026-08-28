---
name: wingslite-facebook-decision
description: Apply Wingslite-specific Facebook growth standards using Doris delivery and cohort data. Use for Wingslite target evaluation, anomaly judgment, human-reviewed adjustment recommendations, budget increase or decrease decisions, and weekly rule iteration. Do not use for WingsAI or for executing ad changes without explicit approval.
---

# Wingslite Facebook Decision

Use this Skill only for `WingsLite(Android)` and the explicitly maintained
Facebook account IDs. Always read
[the decision standards](references/decision-standards.md) before analyzing data
or producing a judgment.

## Required sequence

1. Validate source freshness, cohort maturity, account scope, and required
   dimensions. Data-quality failures are incidents, not performance anomalies.
2. Evaluate the product line against the approved target and guard metrics.
   Never substitute a rolling average for an approved business target.
3. Diagnose a detected anomaly through the Facebook delivery tree and the
   Doris product-outcome tree. Separate facts, likely causes, hypotheses, and
   missing evidence.
4. Write one preliminary judgment with evidence, confidence, and an optional
   candidate rule. Wait for a human outcome: confirmed, deferred, or rejected.
5. Generate adjustment recommendations only for confirmed judgments. Keep
   judgment outcomes out of recommendation adoption-rate calculations.
6. Apply the increase, decrease, hold, or stop gates in the decision standards.
   If a required numeric threshold is unset, state that the decision is blocked
   on calibration; do not invent a number.
7. Track accepted recommendations through their mature observation window.
   Preserve both successful and unsuccessful results for the weekly review.

## Safety

- Never merge WingsAI data or accounts into Wingslite.
- Do not use Meta Purchase count or purchase ROAS for budget decisions until
  event mapping is validated against Doris.
- A recommendation is not execution authorization. Budget, targeting, status,
  or creative changes require explicit approval for the exact action.
- Preserve channel, account, campaign, ad set, audience, ad, and creative IDs.

## Learning contract

Confirmed and rejected judgments may create candidate rules. Promote a rule
only after repeated mature evidence or explicit product-owner approval. Record
the supporting judgment/experiment IDs, approver, date, and new Skill version.
