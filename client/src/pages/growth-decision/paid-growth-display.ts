import type { MetaAdEntity } from '@shared/api.interface';
import { metaTargets } from '@shared/meta-targets';

const numberFormats = new Map<number, Intl.NumberFormat>();

export function formatBiNumber(value: number | null, decimals = 2) {
  if (value === null) return '—';
  let format = numberFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('zh-CN', {
      maximumFractionDigits: decimals,
    });
    numberFormats.set(decimals, format);
  }
  return format.format(value);
}

/** A BI campaign row has no account ID. Only join Meta when ownership is unique. */
export function paidCampaignTargets(
  campaignIds: Set<string>,
  entities: MetaAdEntity[],
) {
  type Targets = {
    metaObjectives: string[];
    metaOptimizationGoals: string[];
    metaConversionEvents: string[];
  };
  const targets = new Map<string, Targets>();
  if (!campaignIds.size) return targets;
  const groups = new Map<string, MetaAdEntity[]>();
  for (const entity of entities) {
    if (!campaignIds.has(entity.campaignId)) continue;
    const group = groups.get(entity.campaignId);
    if (group) group.push(entity);
    else groups.set(entity.campaignId, [entity]);
  }
  for (const id of campaignIds) {
    const group = groups.get(id);
    if (
      !group?.[0].accountId ||
      group.some((entity) => entity.accountId !== group[0].accountId)
    )
      continue;
    const { objectives, optimizationGoals, conversionEvents } =
      metaTargets(group);
    targets.set(id, {
      metaObjectives: objectives,
      metaOptimizationGoals: optimizationGoals,
      metaConversionEvents: conversionEvents,
    });
  }
  return targets;
}
