import type {
  GrowthJudgment,
  GrowthDecisionCase,
  MetaOperation,
  OperationDecisionEvidence,
  SavedCampaignRecommendation,
} from '@shared/api.interface';

/** Never infer a historical recommendation from today's rules or backfilled data. */
export function operationDecisionEvidence(
  op: MetaOperation,
  records: Array<GrowthJudgment | GrowthDecisionCase>,
  saved: SavedCampaignRecommendation[] = [],
): OperationDecisionEvidence {
  const evidence: OperationDecisionEvidence = {
    operationId: op.id,
    capturedAt: new Date().toISOString(),
    state: 'unknown',
    explanation: '操作前没有可核验的同账户、同系列建议，无法判断是否冲突',
  };
  if (op.systemActor || op.category === 'other')
    return {
      ...evidence,
      explanation: '系统/初始化/非措施事件不判断人工决策冲突',
    };
  const candidates = records
    .filter(
      (r): r is GrowthJudgment =>
        'preliminaryJudgment' in r &&
        !r.deletedAt &&
        !!r.campaignReview &&
        r.productId === op.productId &&
        r.campaignReview.card.snapshot.accountId === op.accountId &&
        r.campaignReview.card.snapshot.campaignId === op.campaignId &&
        Date.parse(r.createdAt) < Date.parse(op.occurredAt) &&
        Date.parse(op.occurredAt) - Date.parse(r.createdAt) <= 7 * 86400000 &&
        Date.parse(r.campaignReview.card.snapshot.fetchedAt) <=
          Date.parse(op.occurredAt),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const choices: SavedCampaignRecommendation[] = [
    ...saved,
    ...candidates.map((r) => ({
      id: r.id,
      productId: r.productId,
      createdAt: r.createdAt,
      skillVersion: '',
      card: r.campaignReview!.card,
    })),
  ]
    .filter(
      (r) =>
        r.productId === op.productId &&
        r.card.snapshot.accountId === op.accountId &&
        r.card.snapshot.campaignId === op.campaignId &&
        Date.parse(r.createdAt) < Date.parse(op.occurredAt) &&
        Date.parse(op.occurredAt) - Date.parse(r.createdAt) <= 7 * 86400000 &&
        Date.parse(r.card.snapshot.fetchedAt) <= Date.parse(op.occurredAt),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const source = choices[0];
  if (!source) return evidence;
  const card = source.card;
  const actual = {
    increase: 'increase',
    decrease: 'decrease',
    pause: 'pause',
    resume: 'resume',
    adjust: 'adjust_ads',
  }[op.category];
  return {
    ...evidence,
    state: card.verdict === actual ? 'aligned' : 'conflict',
    explanation:
      card.verdict === actual
        ? '人工实际操作与操作前保存的系统方向一致'
        : '实际操作与操作前系统建议方向不同；差异不代表人工错误，需结合结果复盘',
    recommendation: {
      sourceId: source.id,
      recordedAt: source.createdAt,
      verdict: card.verdict,
      rule: card.matchedRule,
      action: card.primaryAction.rationale,
      skillVersion: source.skillVersion,
      ruleDefinition: source.rules?.find((r) => r.id === card.matchedRule?.id),
      dataDate: card.snapshot.dataDate,
      metrics: card.snapshot.metrics,
    },
  };
}
