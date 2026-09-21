import type { MetaAdEntity, MetaTargetSummary } from './meta-operations';

/** Exact ad-set configuration only; campaign names are not evidence of an event. */
export function adsetEvent(entity: MetaAdEntity): string | undefined {
  if (entity.level !== 'adset') return undefined;
  if (entity.optimizationGoal === 'APP_INSTALLS') return 'install';
  const event = entity.conversionEvent?.trim();
  if (!event || event === 'OTHER') return undefined;
  return event === 'PURCHASE' ? 'purchase' : event;
}

export function metaTargets(entities: MetaAdEntity[]): MetaTargetSummary {
  const values = (
    field: 'objective' | 'optimizationGoal' | 'conversionEvent',
  ) =>
    [...new Set(entities.flatMap((e) => (e[field] ? [e[field]!] : [])))].sort();
  const adsets = entities.filter((e) => e.level === 'adset');
  const events = [
    ...new Set(adsets.flatMap((e) => (adsetEvent(e) ? [adsetEvent(e)!] : []))),
  ].sort();
  return {
    objectives: values('objective'),
    optimizationGoals: values('optimizationGoal'),
    conversionEvents: events,
    fetchedAt: entities
      .map((e) => e.fetchedAt)
      .sort()
      .at(-1),
    eventStatus: events.length
      ? 'returned'
      : adsets.length &&
          adsets.every((e) => e.conversionEventStatus === 'not_configured')
        ? 'not_configured'
        : adsets.length &&
            adsets.every((e) => e.conversionEventStatus === 'unsupported')
          ? 'unsupported'
          : 'pending',
  };
}

export const metaEventStatusLabel = {
  returned: '已返回',
  not_configured: 'Meta 未配置具体事件',
  unsupported: '当前 Meta 接口不支持该字段',
  pending: '待同步广告组事件',
};
