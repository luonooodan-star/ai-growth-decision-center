import type { CampaignDecisionCard, GrowthProduct } from '@shared/api.interface';
import { campaignMetric } from './campaign-decision-engine';

/** Delivery integrity, attribution latency, and product configuration are different states. */
export function campaignDataHealth(card: CampaignDecisionCard, product: GrowthProduct, now = new Date()): NonNullable<CampaignDecisionCard['dataHealth']> {
  const s = card.snapshot;
  const reasons = [...s.qualityIssues];
  if (card.staleHistory) reasons.push('快照已过期，需刷新 Doris 数据');
  if (!Number.isFinite(s.metrics.spend)) reasons.push('投放消耗缺失，不能以 0 代替');
  if ((product.channel || 'facebook').toLowerCase() === 'facebook' && !s.accountId)
    reasons.push('Facebook 账户尚未定位，等待广告实体映射');
  if (reasons.length) return { state: 'repair', reasons: [...new Set(reasons)],
    nextStep: '每小时抓取自动续补失败分片；账户问题由 Meta 实体同步补齐。持续失败请查看 Doris 抓取历史的具体缺口。' };
  const metric = product.metrics.find(m => m.key === product.targetMetric);
  if (!metric || metric.availability === 'pending') return { state: 'waiting',
    reasons: ['产品主目标的数据口径尚未配置，不属于抓取故障'], nextStep: '先在指标库配置已支持的主目标与标准。' };
  if (campaignMetric(s, product.targetMetric) === undefined) {
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const age = (Date.parse(today) - Date.parse(s.dataDate)) / 86400000;
    const zeroDenominator = (['d0_roas', 'roas'].includes(product.targetMetric) && s.metrics.spend === 0)
      || (['cpi', 'arpu'].includes(product.targetMetric) && s.metrics.adjust_installs === 0)
      || (['ecpm', 'ctr', 'ipm'].includes(product.targetMetric) && s.metrics.impressions === 0);
    if (zeroDenominator) return { state: 'waiting', reasons: ['指标分母为 0，当前比率不适用'], nextStep: '保留真实投放数据，不生成虚假的比率或补数任务。' };
    if (product.targetMetric === 'd0_roas' && age <= 2) return { state: 'waiting',
      reasons: ['投放数据已返回，成熟 D0 尚未回传（最长观察至数据日后 2 天）'],
      nextStep: '自动抓取会继续更新成熟 cohort；当前不作达标判断，超期仍缺失再转入修复。' };
    return { state: 'repair', reasons: ['主目标指标持续未返回，需核对 Doris 源数据和关联粒度'],
      nextStep: '重新抓取最近 7 天；如仍缺失，核查抓取历史与源表，不将缺失视为正常。' };
  }
  return { state: 'ready', reasons: [], nextStep: '数据可用于判断，样本量和产品规则另行校验。' };
}
