import type { MetaAdjustmentJob } from '@shared/meta-adjustment';
import type { MetaOperation } from '@shared/api.interface';

/** Read-only deterministic projection. No replay, import request, or Graph API call. */
export function adjustmentOperations(
  jobs: MetaAdjustmentJob[],
): MetaOperation[] {
  return jobs.flatMap((job) =>
    job.items.flatMap((item, index) => {
      if (item.state !== 'succeeded' || !item.after || !item.completedAt)
        return [];
      const fields: Array<{
        field: 'budget' | 'status';
        before: string | number;
        after: string | number;
      }> = [];
      if (
        item.dailyBudget !== undefined &&
        item.before.dailyBudget !== null &&
        item.after.dailyBudget !== null &&
        item.before.dailyBudget !== item.after.dailyBudget &&
        Number.isFinite(Number(item.before.dailyBudget)) &&
        Number.isFinite(Number(item.after.dailyBudget))
      )
        fields.push({
          field: 'budget',
          before: Number(item.before.dailyBudget),
          after: Number(item.after.dailyBudget),
        });
      if (item.status && item.before.status !== item.after.status)
        fields.push({
          field: 'status',
          before: item.before.status,
          after: item.after.status,
        });
      return fields.map(
        ({ field, before, after }): MetaOperation => ({
          id: `adjustment-${job.id}-${index}-${field}`,
          source: 'adjustment_page',
          deliveryStatus: item.after!.effectiveStatus,
          adsetId: item.before.adsetId,
          adjustmentJobId: job.id,
          capturedEvidence: item.evidence,
          accountId: item.before.accountId,
          campaignId: item.before.campaignId,
          objectId: item.before.id,
          objectName: item.before.name,
          objectLevel: item.before.level,
          actorId: job.ownerId,
          actorName: job.centerUsername
            ? `${job.centerUsername} · Meta ${job.ownerId}`
            : `已授权 Meta 用户 ${job.ownerId}`,
          systemActor: false,
          occurredAt: item.startedAt || item.completedAt,
          importedAt: item.completedAt,
          accountTimezone: 'UTC',
          eventType:
            field === 'budget'
              ? '广告调整页：日预算修改'
              : '广告调整页：启停修改',
          field,
          before,
          after,
          raw: JSON.stringify({
            jobId: job.id,
            centerUsername: job.centerUsername,
            metaOwnerId: job.ownerId,
            itemIndex: index,
            currency: item.before.currency,
            budgetUnit: 'Meta minor currency unit',
            before: item.before,
            after: item.after,
            completedAt: item.completedAt,
          }),
          category:
            field === 'budget'
              ? Number(after) > Number(before)
                ? 'increase'
                : 'decrease'
              : after === 'PAUSED'
                ? 'pause'
                : after === 'ACTIVE'
                  ? 'resume'
                  : 'adjust',
          changePct:
            field === 'budget' && Number(before) > 0
              ? (Number(after) / Number(before) - 1) * 100
              : undefined,
          linked: !!item.evidence?.productId,
          productId: item.evidence?.productId,
        }),
      );
    }),
  );
}

export function mergeOperationSources(
  local: MetaOperation[],
  imported: MetaOperation[],
): MetaOperation[] {
  // Keep historical imports. Suppress a mirror of a local write only on exact actor/object/value and close time.
  return [
    ...local,
    ...imported.filter(
      (o) =>
        !local.some(
          (l) =>
            l.accountId === o.accountId &&
            l.objectId === o.objectId &&
            l.actorId === o.actorId &&
            l.field === o.field &&
            String(l.before) === String(o.before) &&
            String(l.after) === String(o.after) &&
            Math.abs(Date.parse(l.occurredAt) - Date.parse(o.occurredAt)) <=
              60000,
        ),
    ),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
