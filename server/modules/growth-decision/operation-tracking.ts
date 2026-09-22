import type {
  MetaOperation,
  CampaignDailySnapshot,
} from '@shared/api.interface';
import type { OperationObservation } from '@shared/meta-operations';

export const OBSERVATION_INTERVAL_MS = 3 * 3600000;

/** Track the newest adjustment per object; never interpret a child pause as a campaign pause. */
export function activeOperationAnchors(
  operations: MetaOperation[],
): MetaOperation[] {
  const latest = new Map<string, MetaOperation>();
  for (const op of [...operations].sort(
    (a, b) =>
      b.occurredAt.localeCompare(a.occurredAt) ||
      Number(b.field === 'status') - Number(a.field === 'status'),
  )) {
    if (op.source !== 'adjustment_page' || !op.campaignId) continue;
    const key = `${op.accountId}:${op.objectId}`;
    if (!latest.has(key)) latest.set(key, op);
  }
  return [...latest.values()].filter((op) => {
    const campaign = latest.get(`${op.accountId}:${op.campaignId}`);
    const adset = op.adsetId
      ? latest.get(`${op.accountId}:${op.adsetId}`)
      : undefined;
    return (
      op.category !== 'pause' &&
      op.deliveryStatus === 'ACTIVE' &&
      campaign?.category !== 'pause' &&
      adset?.category !== 'pause'
    );
  });
}

export function periodicObservation(
  op: MetaOperation,
  previous: OperationObservation[],
  snapshots: CampaignDailySnapshot[],
  now = new Date(),
): OperationObservation | undefined {
  const elapsed = now.getTime() - Date.parse(op.occurredAt);
  const slot = Math.floor(elapsed / OBSERVATION_INTERVAL_MS);
  if (!Number.isFinite(slot) || slot < 1 || !op.campaignId) return;
  const id = `${op.id}:periodic:${slot}`;
  if (previous.some((p) => p.id === id)) return;
  const dueAt = Date.parse(op.occurredAt) + slot * OBSERVATION_INTERVAL_MS;
  const snapshot = snapshots
    .filter(
      (s) =>
        s.accountId === op.accountId &&
        s.campaignId === op.campaignId &&
        Date.parse(s.fetchedAt) >= dueAt &&
        Date.parse(s.fetchedAt) <= now.getTime(),
    )
    .sort(
      (a, b) =>
        b.dataDate.localeCompare(a.dataDate) ||
        b.fetchedAt.localeCompare(a.fetchedAt),
    )[0];
  // No stale-cache copies and no fabricated historical 3h points after downtime.
  if (!snapshot) return;
  return {
    id,
    operationId: op.id,
    productId: op.productId,
    accountId: op.accountId,
    campaignId: op.campaignId,
    objectId: op.objectId,
    observedAt: snapshot.fetchedAt,
    kind: 'periodic',
    snapshot,
    note: 'Doris 系列累计快照（非三小时增量）；以数据日、源端抓取时间和完整性标记为准。',
  };
}
