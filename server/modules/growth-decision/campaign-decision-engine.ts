import type {
  CampaignDailySnapshot,
  CampaignDecisionCard,
  CampaignDecisionPolicy,
  CampaignDecisionRule,
  CampaignVerdict,
  GrowthActionProposal,
  GrowthDecisionCase,
  GrowthDiagnosticBreakdown,
  GrowthMetricDefinition,
  GrowthProduct,
} from '@shared/api.interface';
import { campaignHash } from './campaign-snapshots';
import { matchCampaignRule } from './campaign-rules';

export const DEFAULT_CAMPAIGN_POLICY: CampaignDecisionPolicy = {
  minSpend: 30,
  minInstalls: 100,
  consecutiveDays: 2,
  increasePct: 10,
  decreasePct: 20,
  reviewHours: 24,
};

export function previousDay(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
}

export function campaignMetric(
  snapshot: CampaignDailySnapshot,
  key: string,
): number | undefined {
  if (key === 'arpu') {
    const { adjust_revenue: revenue, adjust_installs: installs } =
      snapshot.metrics;
    return revenue !== undefined && installs && installs > 0
      ? revenue / installs
      : undefined;
  }
  return snapshot.metrics[key];
}

function inRange(
  value: number | undefined,
  metric: GrowthMetricDefinition,
): boolean {
  return (
    value !== undefined &&
    Number.isFinite(value) &&
    (metric.lowerBound === undefined || value >= metric.lowerBound) &&
    (metric.upperBound === undefined || value <= metric.upperBound)
  );
}

export function buildCampaignCard(
  product: GrowthProduct,
  snapshots: CampaignDailySnapshot[],
  orders: GrowthDecisionCase[],
  now = new Date(),
  relatedKeys: string[] = [],
): CampaignDecisionCard {
  const today: string = now.toLocaleDateString('en-CA', {
    timeZone: 'Asia/Shanghai',
  });
  const sorted: CampaignDailySnapshot[] = [...snapshots].sort((a, b) =>
    b.dataDate.localeCompare(a.dataDate),
  );
  const completedDays = sorted.filter((s) => s.dataDate < today);
  // Exclude unfinished today, but never skip yesterday's quality failures to
  // cherry-pick a healthy older day. Existing freshness/sample guards still apply.
  const trend: CampaignDailySnapshot[] = (
    completedDays.length ? completedDays : sorted
  ).slice(0, 7);
  const snapshot: CampaignDailySnapshot = trend[0];
  const policy: CampaignDecisionPolicy =
    product.decisionPolicy || DEFAULT_CAMPAIGN_POLICY;
  const previous: CampaignDailySnapshot | undefined = trend.find(
    (s) => s.dataDate === previousDay(snapshot.dataDate),
  );
  const metric: GrowthMetricDefinition | undefined = product.metrics.find(
    (m) => m.key === product.targetMetric,
  );
  const blockers: string[] = [...snapshot.qualityIssues];
  const age: number =
    (new Date(`${today}T00:00:00Z`).getTime() -
      new Date(`${snapshot.dataDate}T00:00:00Z`).getTime()) /
    86400000;
  if (age < 1) blockers.push('当前数据日尚未结束');
  if (
    age > 2 ||
    now.getTime() - new Date(snapshot.fetchedAt).getTime() >
      Math.max(3, product.dataDelayMinutes / 30) * 3600000
  ) {
    blockers.push('数据已过期，需要重新抓取');
  }
  if (
    !metric ||
    (metric.lowerBound === undefined && metric.upperBound === undefined)
  )
    blockers.push('尚未配置产品主目标达标范围');
  if (!metric || campaignMetric(snapshot, metric.key) === undefined)
    blockers.push('主目标指标未返回，不能判断达标');
  if (
    (snapshot.metrics.spend ?? -1) < policy.minSpend ||
    (snapshot.metrics.adjust_installs ?? -1) < policy.minInstalls
  ) {
    blockers.push(
      `样本不足：单日需消耗 ≥ $${policy.minSpend} 且 Adjust 安装 ≥ ${policy.minInstalls}`,
    );
  }
  const recentOrders: GrowthDecisionCase[] = orders.filter(
    (o) =>
      !o.deletedAt &&
      Boolean(o.campaignExecution) &&
      [snapshot.key, ...relatedKeys].includes(o.campaignExecution!.campaignKey),
  );
  if (
    recentOrders.some(
      (o) =>
        o.campaignExecution?.state === 'pending' ||
        (o.campaignExecution?.state === 'executed' && o.status !== 'completed'),
    )
  ) {
    blockers.push('已有待执行或观测中的措施，先复查该措施');
  }
  let expectedDate: string = snapshot.dataDate;
  const contiguous: CampaignDailySnapshot[] = [];
  for (const day of trend) {
    if (
      day.dataDate !== expectedDate ||
      day.qualityIssues.length ||
      (day.metrics.spend ?? -1) < policy.minSpend ||
      (day.metrics.adjust_installs ?? -1) < policy.minInstalls
    )
      break;
    contiguous.push(day);
    expectedDate = previousDay(expectedDate);
  }
  const enoughDays: boolean = contiguous.length >= policy.consecutiveDays;
  const good: boolean = Boolean(
    metric &&
    enoughDays &&
    contiguous
      .slice(0, policy.consecutiveDays)
      .every((s) => inRange(campaignMetric(s, metric.key), metric)),
  );
  const bad: boolean = Boolean(
    metric &&
    enoughDays &&
    contiguous.slice(0, policy.consecutiveDays).every((s) => {
      const v: number | undefined = campaignMetric(s, metric.key);
      return (
        v !== undefined &&
        (metric.direction === 'higher'
          ? metric.lowerBound !== undefined && v < metric.lowerBound
          : metric.upperBound !== undefined && v > metric.upperBound)
      );
    }),
  );
  // Secondary targets can block scaling, but a favorable outlier alone is not a stop-loss signal.
  const secondaryFailures: string[] = product.metrics
    .filter((m) => {
      if (m.key === product.targetMetric) return false;
      const v: number | undefined = campaignMetric(snapshot, m.key);
      return (
        v !== undefined &&
        (m.lowerBound !== undefined || m.upperBound !== undefined) &&
        !inRange(v, m)
      );
    })
    .map((m) => `${m.label} 未达到产品标准`);
  const adSpend: number = snapshot.breakdowns
    .filter((b) => b.dimension === 'ad')
    .reduce((sum, b) => sum + (b.metrics.spend || 0), 0);
  const adCoverageMatches: boolean =
    snapshot.metrics.spend !== undefined &&
    snapshot.metrics.spend > 0 &&
    Math.abs(adSpend - snapshot.metrics.spend) / snapshot.metrics.spend < 0.01;
  const ad: GrowthDiagnosticBreakdown | undefined = snapshot.breakdowns
    .filter(
      (b) =>
        adCoverageMatches &&
        b.dimension === 'ad' &&
        (b.metrics.spend ?? 0) >= (snapshot.metrics.spend ?? 0) * 0.2 &&
        (b.metrics.impressions ?? 0) >= 1000 &&
        b.metrics.ctr !== undefined &&
        snapshot.metrics.ctr !== undefined &&
        b.metrics.ctr < snapshot.metrics.ctr * 0.5,
    )
    .sort((a, b) => (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0))[0];
  let verdict: CampaignVerdict = 'observe';
  let reason: string = blockers[0] || '等待连续完整数据日，下一次抓取后复查';
  if (!blockers.length) {
    if (bad) {
      verdict = 'decrease';
      reason = `连续 ${policy.consecutiveDays} 个完整数据日 ${metric?.label} 未达标，建议收缩投入`;
    } else if (ad) {
      verdict = 'adjust_ads';
      reason = `广告 ${ad.label || ad.value} 消耗占比高且 CTR 明显落后，建议素材对照`;
    } else if (good && !secondaryFailures.length) {
      verdict = 'increase';
      reason = `连续 ${policy.consecutiveDays} 个完整数据日达标，进入小幅加量候选`;
    } else if (
      metric &&
      inRange(campaignMetric(snapshot, metric.key), metric) &&
      !secondaryFailures.length
    ) {
      verdict = 'normal';
      reason = '当前表现达标，维持投放并积累连续数据';
    } else reason = secondaryFailures[0] || reason;
  }
  const matchedRule: CampaignDecisionRule | undefined = !blockers.length
    ? matchCampaignRule(product.campaignRules || [], contiguous, campaignMetric)
    : undefined;
  let appliedRule: CampaignDecisionRule | undefined;
  if (matchedRule) {
    if (
      matchedRule.verdict === 'increase' &&
      (!good || secondaryFailures.length)
    ) {
      verdict = 'observe';
      reason = `规则「${matchedRule.name}」命中，但主目标未连续达标或其他指标未达标，暂不加量`;
    } else if (
      matchedRule.verdict === 'normal' &&
      (!metric ||
        !inRange(campaignMetric(snapshot, metric.key), metric) ||
        secondaryFailures.length)
    ) {
      verdict = 'observe';
      reason = `规则「${matchedRule.name}」命中，但当前存在未达标指标，不能标为正常`;
    } else {
      appliedRule = matchedRule;
      verdict = matchedRule.verdict;
      reason = `规则「${matchedRule.name}」：${matchedRule.actionText}`;
    }
  }
  const actionType: GrowthActionProposal['actionType'] =
    verdict === 'increase'
      ? 'increase_budget'
      : verdict === 'decrease'
        ? 'decrease_budget'
        : verdict === 'adjust_ads'
          ? 'rotate_creative'
          : verdict === 'normal'
            ? 'hold_budget'
            : 'observe';
  const primaryAction: GrowthActionProposal = {
    actionType,
    targetLevel: verdict === 'adjust_ads' && ad ? 'ad' : 'campaign',
    targetId: verdict === 'adjust_ads' && ad ? ad.value : snapshot.campaignId,
    targetName:
      verdict === 'adjust_ads' && ad
        ? ad.label || ad.value
        : snapshot.campaignName,
    changePct:
      verdict === 'increase'
        ? Math.min(
            appliedRule?.changePct ?? policy.increasePct,
            policy.increasePct,
          )
        : verdict === 'decrease'
          ? -Math.min(
              appliedRule?.changePct ?? policy.decreasePct,
              policy.decreasePct,
            )
          : undefined,
    rationale: reason,
    steps: appliedRule
      ? [
          appliedRule.actionText,
          '登记实际执行内容，只改变一个变量并记录后续成熟数据',
        ]
      : verdict === 'adjust_ads'
        ? [
            '保留原广告作为对照，创建仅替换素材的测试广告',
            '登记实际执行内容，比较后续 CTR、安装和成熟回报',
          ]
        : verdict === 'increase' || verdict === 'decrease'
          ? [
              '确认实际预算控制层级和当前日预算，按执行单调整',
              '登记已执行，复查安装量与产品主目标',
            ]
          : [
              '维持当前设置',
              `下一完整数据日或 ${policy.reviewHours} 小时后复查`,
            ],
    guardrails: [
      '金额使用实际日预算，不能把当日消耗当预算',
      '确认本页国家覆盖系列全部投放，否则不可将局部效果用于整个系列加减预算',
      '一次只改变一个变量，保留执行前设置',
    ],
    rollbackCondition:
      '加量后主目标越过不利边界，或减量后规模跌破人工可接受值时，复核并恢复已登记的原设置。',
    observationHours: policy.reviewHours,
  };
  return {
    key: snapshot.key,
    revision: campaignHash([
      trend.map((s) => ({ ...s, fetchedAt: undefined })),
      policy,
      product.campaignRules || [],
      product.metrics,
      product.targetMetric,
    ]),
    snapshot,
    currentDaySnapshot: sorted.find((s) => s.dataDate === today),
    previous,
    trend,
    verdict,
    reason,
    matchedRule: matchedRule
      ? { id: matchedRule.id, name: matchedRule.name }
      : undefined,
    urgent: matchedRule
      ? matchedRule.urgent
      : verdict === 'decrease' || verdict === 'adjust_ads',
    evidence: [
      `数据日 ${snapshot.dataDate}；覆盖国家 ${snapshot.countries.join('、') || '未返回'}`,
      previous ? `环比对照 ${previous.dataDate}` : '前一天无同系列可比数据',
      `连续可比且满足样本门槛 ${contiguous.length} 天`,
      ...secondaryFailures,
    ],
    blockers,
    priority:
      (snapshot.metrics.spend ?? 0) *
      (verdict === 'decrease'
        ? 3
        : verdict === 'increase'
          ? 2
          : verdict === 'adjust_ads'
            ? 1.5
            : 0.5),
    primaryAction,
    recentOrders,
  };
}
