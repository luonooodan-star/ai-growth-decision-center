import type {
  CampaignDecisionCard,
  GrowthDecisionCase,
} from '@shared/api.interface';
import { campaignHash } from './campaign-snapshots';

export function activeOrder(order: GrowthDecisionCase): boolean {
  return (
    !order.deletedAt &&
    order.status !== 'completed' &&
    !order.campaignExecution?.reviewCompletedAt &&
    ['pending', 'executed', 'observing'].includes(
      order.campaignExecution?.state || '',
    )
  );
}

export function workQueue(
  card: CampaignDecisionCard,
  now = Date.now(),
): NonNullable<CampaignDecisionCard['workQueue']> {
  const active = card.recentOrders.filter(activeOrder);
  if (active.some((o) => o.campaignExecution?.state === 'pending'))
    return 'pending';
  if (
    active.some(
      (o) => reviewDeadline(o) && Date.parse(reviewDeadline(o)!) <= now,
    )
  )
    return 'due';
  if (card.noRecentDelivery)
    return card.noDeliveryHideAfter &&
      Date.parse(card.noDeliveryHideAfter) <= now
      ? 'archive'
      : 'inactive';
  // Stale or incomplete acquisition data is a repair task, never evidence of zero spend.
  if (
    card.staleHistory ||
    card.snapshot.qualityIssues.length ||
    card.snapshot.metrics.spend === undefined ||
    card.blockers.some((b) => /未返回|无该系列快照/.test(b))
  )
    return 'repair';
  if (
    card.urgent ||
    card.verdict === 'decrease' ||
    card.verdict === 'adjust_ads'
  )
    return 'urgent';
  if (active.length) return 'observation';
  return card.verdict === 'increase'
    ? 'opportunity'
    : card.verdict === 'normal'
      ? 'normal'
      : 'observation';
}

export function reviewDeadline(order: GrowthDecisionCase): string | undefined {
  const execution = order.campaignExecution;
  if (!execution || !['observing', 'executed'].includes(execution.state))
    return undefined;
  if (execution.reviewDueAt) return execution.reviewDueAt;
  const start = Date.parse(execution.executedAt || execution.acceptedAt);
  return Number.isFinite(start)
    ? new Date(
        start + (execution.proposal.observationHours || 24) * 3600000,
      ).toISOString()
    : undefined;
}

// Exact evidence fingerprint; canReuseAnalysis additionally permits small same-day
// changes only when decision conditions, dimension identities and completeness match.
export function analysisEvidence(card: CampaignDecisionCard): string {
  return campaignHash({
    key: card.key,
    verdict: card.verdict,
    urgent: card.urgent,
    blockers: card.blockers,
    action: card.primaryAction,
    rule: card.matchedRule,
    trend: card.trend.map(({ fetchedAt: _f, ...s }) => s),
  });
}

export function canReuseAnalysis(
  before: CampaignDecisionCard,
  after: CampaignDecisionCard,
): boolean {
  if (
    after.workQueue === 'due' ||
    before.snapshot.dataDate !== after.snapshot.dataDate
  )
    return false;
  const decision = (c: CampaignDecisionCard) => ({
    key: c.key,
    verdict: c.verdict,
    urgent: c.urgent,
    blockers: c.blockers,
    action: c.primaryAction,
    rule: c.matchedRule,
  });
  if (campaignHash(decision(before)) !== campaignHash(decision(after)))
    return false;
  if (analysisEvidence(before) === analysisEvidence(after)) return true;
  const metricsStable = (
    a: Record<string, number | undefined>,
    b: Record<string, number | undefined>,
  ): boolean =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => {
      if (a[k] === b[k]) return true;
      if (
        a[k] === undefined ||
        b[k] === undefined ||
        !Number.isFinite(a[k]) ||
        !Number.isFinite(b[k]) ||
        a[k] === 0
      )
        return false;
      return Math.abs(b[k]! / a[k]! - 1) < 0.1;
    });
  if (before.trend.length !== after.trend.length) return false;
  return before.trend.every((s, i) => {
    const next = after.trend[i];
    if (
      s.dataDate !== next.dataDate ||
      !metricsStable(s.metrics, next.metrics) ||
      campaignHash(s.qualityIssues) !== campaignHash(next.qualityIssues) ||
      s.breakdowns.length !== next.breakdowns.length
    )
      return false;
    return s.breakdowns.every((b) => {
      const n = next.breakdowns.find(
        (x) => x.dimension === b.dimension && x.value === b.value,
      );
      return !!n && metricsStable(b.metrics, n.metrics);
    });
  });
}
