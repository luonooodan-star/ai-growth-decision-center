import type { CampaignDecisionRule } from '@shared/api.interface';

export const ANOMALY_TEMPLATES = [
  { metric: 'cpi', label: 'CPI 突涨并越界', value: 30, operator: 'gte' },
  { metric: 'ctr', label: 'CTR 突降', value: -30, operator: 'lte' },
  { metric: 'd0_roas', label: 'D0 ROAS 突降', value: -30, operator: 'lte' },
  { metric: 'ecpm', label: '买量 CPM 突降', value: -30, operator: 'lte' },
] as const;

export function anomalyTemplate(
  index: number,
  id: string,
): CampaignDecisionRule {
  const template = ANOMALY_TEMPLATES[index];
  return {
    id,
    name: template.label,
    enabled: false,
    urgent: true,
    priority: 90,
    verdict: 'observe',
    consecutiveDays: 1,
    actionText:
      '优先核查前一天对比、广告组及广告贡献；人工确认原因后决定调整措施，不自动修改预算。',
    conditions: [
      {
        metric: template.metric,
        basis: 'previous_day_change',
        operator: template.operator,
        value: template.value,
      },
      ...(template.metric === 'cpi'
        ? [
            {
              metric: 'cpi' as const,
              basis: 'value' as const,
              operator: 'gte' as const,
              value: Number.NaN,
            },
          ]
        : []),
    ],
  };
}
