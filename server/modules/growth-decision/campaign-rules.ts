import { BadRequestException } from '@nestjs/common';
import type {
  CampaignDailySnapshot,
  CampaignDecisionRule,
} from '@shared/api.interface';

const METRICS = [
  'spend',
  'impressions',
  'media_clicks',
  'media_installs',
  'adjust_installs',
  'adjust_revenue',
  'cpi',
  'cpa',
  'd0_roas',
  'ecpm',
  'ctr',
  'ipm',
  'roas',
  'retention_d1',
  'ipu',
  'arpu',
];
const VERDICTS = ['increase', 'decrease', 'adjust_ads', 'observe', 'normal'];

export function validateCampaignRules(
  input: CampaignDecisionRule[],
): CampaignDecisionRule[] {
  if (!Array.isArray(input) || input.length > 50)
    throw new BadRequestException('每个产品最多配置 50 条规则');
  const ids: Set<string> = new Set();
  return input.map((rule: CampaignDecisionRule) => {
    if (
      !rule ||
      typeof rule.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(rule.id) ||
      ids.has(rule.id) ||
      typeof rule.name !== 'string' ||
      !rule.name.trim() ||
      rule.name.length > 100 ||
      typeof rule.enabled !== 'boolean' ||
      typeof rule.urgent !== 'boolean' ||
      !VERDICTS.includes(rule.verdict) ||
      !Number.isInteger(rule.priority) ||
      rule.priority < 0 ||
      rule.priority > 100 ||
      !Number.isInteger(rule.consecutiveDays) ||
      rule.consecutiveDays < 1 ||
      rule.consecutiveDays > 7 ||
      typeof rule.actionText !== 'string' ||
      !rule.actionText.trim() ||
      rule.actionText.length > 1000 ||
      !Array.isArray(rule.conditions) ||
      rule.conditions.length < 1 ||
      rule.conditions.length > 8
    ) {
      throw new BadRequestException(
        '规则名称、类别、优先级、连续天数或条件不合法',
      );
    }
    ids.add(rule.id);
    for (const condition of rule.conditions) {
      if (
        !condition ||
        !METRICS.includes(condition.metric) ||
        !['value', 'previous_day_change'].includes(condition.basis) ||
        !['gte', 'lte'].includes(condition.operator) ||
        typeof condition.value !== 'number' ||
        !Number.isFinite(condition.value) ||
        Math.abs(condition.value) > 1e12 ||
        (condition.basis === 'value' && condition.value < 0)
      )
        throw new BadRequestException('规则条件的指标、比较方式或阈值不合法');
    }
    if (
      rule.changePct !== undefined &&
      (typeof rule.changePct !== 'number' ||
        !Number.isFinite(rule.changePct) ||
        rule.changePct <= 0 ||
        !['increase', 'decrease'].includes(rule.verdict) ||
        rule.changePct > (rule.verdict === 'increase' ? 30 : 50))
    ) {
      throw new BadRequestException(
        '加量幅度须在 0～30% 内，减量幅度须在 0～50% 内；其他类别不设置预算幅度',
      );
    }
    return {
      id: rule.id,
      name: rule.name.trim(),
      enabled: rule.enabled,
      verdict: rule.verdict,
      priority: rule.priority,
      urgent: rule.urgent,
      consecutiveDays: rule.consecutiveDays,
      actionText: rule.actionText.trim(),
      changePct: rule.changePct,
      conditions: rule.conditions.map((c) => ({
        metric: c.metric,
        basis: c.basis,
        operator: c.operator,
        value: c.value,
      })),
    };
  });
}

export function matchCampaignRule(
  rules: CampaignDecisionRule[],
  trend: CampaignDailySnapshot[],
  readMetric: (
    snapshot: CampaignDailySnapshot,
    key: string,
  ) => number | undefined,
): CampaignDecisionRule | undefined {
  return [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .find((rule) => {
      if (trend.length < rule.consecutiveDays) return false;
      return trend.slice(0, rule.consecutiveDays).every((snapshot, index) =>
        rule.conditions.every((condition) => {
          let value: number | undefined = readMetric(
            snapshot,
            condition.metric,
          );
          if (condition.basis === 'previous_day_change') {
            const previous = trend[index + 1];
            const baseline: number | undefined =
              previous && readMetric(previous, condition.metric);
            const expectedDate = new Date(
              new Date(`${snapshot.dataDate}T00:00:00Z`).getTime() - 86400000,
            )
              .toISOString()
              .slice(0, 10);
            if (
              !previous ||
              previous.dataDate !== expectedDate ||
              baseline === undefined ||
              baseline <= 0 ||
              value === undefined
            )
              return false;
            value = (value / baseline - 1) * 100;
          }
          if (value === undefined || !Number.isFinite(value)) return false;
          return condition.operator === 'gte'
            ? value >= condition.value
            : value <= condition.value;
        }),
      );
    });
}
