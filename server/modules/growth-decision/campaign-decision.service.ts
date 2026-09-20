import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CampaignDailySnapshot,
  CampaignDecisionBoard,
  CampaignDecisionCard,
  CampaignDecisionPolicy,
  DecideCampaignRequest,
  ExecuteCampaignRequest,
  GrowthActionProposal,
  GrowthDecisionCase,
  GrowthDiagnosticContext,
  GrowthJudgment,
  GrowthProduct,
} from '@shared/api.interface';
import {
  LocalDatabaseService,
  type DecisionRecord,
} from '@server/database/local-database.service';
import { GrowthDecisionService } from './growth-decision.service';
import { GrowthMavisAnalysisService } from './growth-mavis-analysis.service';
import { reconcileCampaignHistory } from './campaign-history';
import {
  canReuseAnalysis,
  workQueue,
  activeOrder,
  reviewDeadline,
} from './campaign-workbench';
import {
  buildCampaignCard,
  campaignMetric,
  DEFAULT_CAMPAIGN_POLICY,
} from './campaign-decision-engine';

@Injectable()
export class CampaignDecisionService {
  constructor(
    private readonly database: LocalDatabaseService,
    private readonly decisions: GrowthDecisionService,
    private readonly analysis: GrowthMavisAnalysisService,
  ) {}

  private product(id: string): GrowthProduct {
    const product: GrowthProduct | undefined = this.database.getProduct(id);
    if (!product) throw new NotFoundException('产品不存在');
    return product;
  }

  board(productId: string): CampaignDecisionBoard {
    const product: GrowthProduct = this.product(productId);
    const snapshots: CampaignDailySnapshot[] =
      this.database.listCampaignSnapshots(productId);
    const records: DecisionRecord[] = this.database.listDecisionRecords(10000);
    const orders: GrowthDecisionCase[] = records
      .filter((r): r is GrowthDecisionCase => !('preliminaryJudgment' in r))
      .map((o) =>
        o.campaignExecution
          ? {
              ...o,
              campaignExecution: {
                ...o.campaignExecution,
                reviewDueAt: reviewDeadline(o),
              },
            }
          : o,
      );
    const items: CampaignDecisionCard[] = reconcileCampaignHistory(snapshots)
      .map(({ snapshots: history, relatedKeys }) => {
        const card: CampaignDecisionCard = buildCampaignCard(
          product,
          history,
          orders,
          new Date(),
          relatedKeys,
        );
        if (relatedKeys.length > 1) {
          card.evidence.push(
            '已使用账户定位后的完整快照；旧未定位卡片不再重复展示，历史措施仍保留关联',
          );
        }
        card.workQueue = workQueue(card);
        const dueAt = Math.max(
          0,
          ...card.recentOrders
            .filter(activeOrder)
            .map(
              (o) => Date.parse(o.campaignExecution?.reviewDueAt || '') || 0,
            ),
        );
        const review: GrowthJudgment | undefined = records.find(
          (r): r is GrowthJudgment =>
            'preliminaryJudgment' in r &&
            !r.deletedAt &&
            r.campaignReview?.key === card.key &&
            (r.aiAnalysisStatus === 'running' ||
              ((card.workQueue !== 'due' || Date.parse(r.createdAt) >= dueAt) &&
                (r.campaignReview.revision === card.revision ||
                  (r.aiAnalysisStatus === 'completed' &&
                    Date.now() - Date.parse(r.createdAt) < 86400000 &&
                    canReuseAnalysis(r.campaignReview.card, card))))),
        );
        if (review) {
          card.analysisId = review.id;
          card.analysisStatus = review.aiAnalysisStatus;
          card.analysis =
            review.aiAnalysisStatus === 'running'
              ? undefined
              : review.aiAnalysis;
          card.analysisReused =
            review.campaignReview?.revision !== card.revision;
          const proposal: GrowthActionProposal | undefined =
            card.analysis?.recommendedActions?.[0];
          // 模型必须沿用经过证据和策略门槛验证的方向，不能从观察直接变成加预算。
          if (
            !card.blockers.length &&
            !card.analysisReused &&
            proposal &&
            proposal.actionType === card.primaryAction.actionType &&
            proposal.targetLevel === card.primaryAction.targetLevel &&
            proposal.targetId === card.primaryAction.targetId
          ) {
            card.primaryAction = {
              ...proposal,
              changePct: card.primaryAction.changePct,
              observationHours: card.primaryAction.observationHours,
              guardrails: [
                ...card.primaryAction.guardrails,
                ...proposal.guardrails,
              ],
            };
          }
        }
        card.workQueue = workQueue(card);
        return card;
      })
      .sort(
        (a, b) =>
          Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)) ||
          b.priority - a.priority,
      );
    return {
      items,
      policy: product.decisionPolicy || DEFAULT_CAMPAIGN_POLICY,
      generatedAt: new Date().toISOString(),
    };
  }

  updatePolicy(
    productId: string,
    policy: CampaignDecisionPolicy,
  ): CampaignDecisionPolicy {
    const limits: Record<keyof CampaignDecisionPolicy, [number, number]> = {
      minSpend: [1, 1000000],
      minInstalls: [1, 1000000],
      consecutiveDays: [1, 7],
      increasePct: [1, 30],
      decreasePct: [1, 50],
      reviewHours: [24, 168],
    };
    const normalized: CampaignDecisionPolicy = { ...DEFAULT_CAMPAIGN_POLICY };
    for (const key of Object.keys(limits) as Array<
      keyof CampaignDecisionPolicy
    >) {
      const value: number = policy?.[key];
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < limits[key][0] ||
        value > limits[key][1] ||
        (['minInstalls', 'consecutiveDays', 'reviewHours'].includes(key) &&
          !Number.isInteger(value))
      ) {
        throw new BadRequestException(
          `策略 ${key} 范围应为 ${limits[key].join('～')}`,
        );
      }
      normalized[key] = value;
    }
    this.database.saveProduct({
      ...this.product(productId),
      decisionPolicy: normalized,
    });
    this.database.appendActivity({
      caseId: productId,
      action: 'campaign_policy_updated',
      actor: 'growth',
      detail: '已更新系列决策策略',
      metadata: { policy: JSON.stringify(normalized) },
    });
    return normalized;
  }

  private currentCard(
    productId: string,
    key: string,
    revision: string,
  ): CampaignDecisionCard {
    const card: CampaignDecisionCard | undefined = this.board(
      productId,
    ).items.find((c) => c.key === key);
    if (!card) throw new NotFoundException('暂无该系列快照，请先抓取 Doris');
    if (card.revision !== revision)
      throw new ConflictException('数据或策略已更新，请刷新后重新确认');
    return card;
  }

  async analyze(
    productId: string,
    key: string,
    revision: string,
    prepareOnly = false,
    force = false,
  ): Promise<GrowthJudgment> {
    const card: CampaignDecisionCard = this.currentCard(
      productId,
      key,
      revision,
    );
    const product: GrowthProduct = this.product(productId);
    if (
      card.analysisId &&
      card.analysisStatus !== 'failed' &&
      (!force || card.analysisStatus === 'running')
    ) {
      return this.database.getDecisionRecord(card.analysisId) as GrowthJudgment;
    }
    if (
      card.noRecentDelivery ||
      card.workQueue === 'repair' ||
      card.staleHistory ||
      card.snapshot.qualityIssues.length ||
      card.snapshot.metrics.spend === undefined
    )
      throw new BadRequestException(
        '无新增投放或数据待修复，先补齐数据再提交效果分析',
      );
    // 强制通过现有 Codex bridge；未配置时明确失败，不能冒充模型输出。
    if (!this.analysis.getStatus(productId).mcpConfigured)
      throw new BadRequestException('请先配置 Codex 任务桥');
    const review: GrowthJudgment = {
      id: force ? randomUUID() : card.analysisId || randomUUID(),
      productId,
      productName: product.name,
      status: 'judgment_pending',
      anomalyType: `系列综合评估：${card.reason}`,
      severity: 'medium',
      channel: product.channel,
      adAccountId: card.snapshot.accountId,
      campaignId: card.snapshot.campaignId,
      campaignName: card.snapshot.campaignName,
      targetMetric: product.targetMetric,
      currentValue: campaignMetric(card.snapshot, product.targetMetric),
      spend: card.snapshot.metrics.spend,
      confidence: 0,
      evidence: card.evidence.join('；'),
      rootCause: '待 Codex 综合分析',
      preliminaryJudgment: card.reason,
      createdAt: new Date().toISOString(),
      diagnosticContext: this.context(card),
      campaignReview: {
        key,
        revision,
        card: { ...card, recentOrders: card.recentOrders.slice(0, 10) },
      },
    };
    this.database.saveDecisionRecord(review);
    if (prepareOnly) return review;
    return this.analysis.analyzeJudgment(review.id, 'external_only');
  }

  async decide(
    productId: string,
    request: DecideCampaignRequest,
  ): Promise<GrowthDecisionCase> {
    if (
      !request ||
      !['accept', 'reject', 'observe'].includes(request.decision) ||
      typeof request.reason !== 'string' ||
      !request.reason.trim()
    )
      throw new BadRequestException('请填写决策及原因');
    const card: CampaignDecisionCard = this.currentCard(
      productId,
      request.key,
      request.revision,
    );
    const existing: GrowthDecisionCase | undefined = card.recentOrders.find(
      (o) =>
        o.campaignExecution?.revision === request.revision &&
        (request.decision === 'accept'
          ? ['pending', 'executed'].includes(o.campaignExecution.state)
          : o.campaignExecution.state ===
            (request.decision === 'reject' ? 'rejected' : 'observing')),
    );
    if (existing) return existing;
    if (request.decision === 'observe') {
      const active = card.recentOrders.find(
        (o) => activeOrder(o) && o.campaignExecution?.state === 'observing',
      );
      if (active) return active;
    }
    if (
      request.decision === 'accept' &&
      (card.blockers.length || ['observe', 'normal'].includes(card.verdict))
    ) {
      throw new BadRequestException(
        card.blockers[0] || '当前建议无需执行变更，可以选择观察',
      );
    }
    const product: GrowthProduct = this.product(productId);
    const proposal: GrowthActionProposal = { ...card.primaryAction };
    if (request.decision === 'observe') {
      proposal.actionType = 'observe';
      proposal.changePct = undefined;
      proposal.rationale = `继续观察：${request.reason.trim()}`;
    }
    let beforeBudget: number | undefined;
    let afterBudget: number | undefined;
    if (
      request.decision === 'accept' &&
      ['increase_budget', 'decrease_budget'].includes(proposal.actionType)
    ) {
      if (
        typeof request.beforeBudget !== 'number' ||
        !Number.isFinite(request.beforeBudget) ||
        request.beforeBudget <= 0 ||
        request.beforeBudget > 1e9 ||
        !['campaign', 'adset'].includes(request.budgetLevel || '')
      )
        throw new BadRequestException('请登记实际日预算和预算控制层级');
      const target: string = request.budgetTargetId || '';
      const valid: boolean =
        request.budgetLevel === 'campaign'
          ? target === card.snapshot.campaignId
          : card.snapshot.breakdowns.some(
              (b) => b.dimension === 'adset' && b.value === target,
            );
      if (!valid) throw new BadRequestException('预算对象不属于当前系列');
      // 系列级加减量不能自动摊给某个广告组；广告组预算需其独立成熟效果证据。
      if (request.budgetLevel === 'adset')
        throw new BadRequestException(
          '本建议基于系列整体效果，仅支持系列预算；广告组预算需先完成该组独立评估',
        );
      beforeBudget = request.beforeBudget;
      afterBudget =
        Math.round(beforeBudget * (1 + (proposal.changePct || 0) / 100) * 100) /
        100;
      if (afterBudget <= 0)
        throw new BadRequestException('调整后的预算必须大于零');
      proposal.targetLevel = request.budgetLevel;
      proposal.targetId = target;
    }
    const now: string = new Date().toISOString();
    const created: GrowthDecisionCase = await this.decisions.ingestCase(
      {
        productId,
        anomalyType: '广告系列综合决策',
        severity: 'medium',
        channel: product.channel,
        adAccountId: card.snapshot.accountId,
        campaignId: card.snapshot.campaignId,
        campaignName: card.snapshot.campaignName,
        adId: proposal.targetLevel === 'ad' ? proposal.targetId : undefined,
        adName: proposal.targetLevel === 'ad' ? proposal.targetName : undefined,
        targetMetric: product.targetMetric,
        currentValue: campaignMetric(card.snapshot, product.targetMetric),
        diagnosticContext: this.context(card),
        spend: card.snapshot.metrics.spend,
        evidence: card.evidence.join('；'),
        rootCause: card.analysis?.primaryCause || card.reason,
        confidence: card.analysis?.confidence || 0,
        recommendation: proposal.rationale,
        recommendedAction: {
          actionType: proposal.actionType,
          targetLevel: proposal.targetLevel,
          targetId: proposal.targetId,
          changePct: proposal.changePct,
        },
        expectedImpact: `${proposal.observationHours} 小时后复查成熟主目标及安装规模，结果待验证`,
        riskNote: proposal.rollbackCondition,
      },
      'growth',
    );
    const order: GrowthDecisionCase = {
      ...created,
      status:
        request.decision === 'accept'
          ? 'awaiting_execution'
          : request.decision === 'reject'
            ? 'rejected'
            : 'observing',
      decisionReason: request.reason.trim(),
      decidedAt: now,
      decidedBy: 'growth',
      campaignExecution: {
        campaignKey: card.key,
        revision: card.revision,
        state:
          request.decision === 'accept'
            ? 'pending'
            : request.decision === 'reject'
              ? 'rejected'
              : 'observing',
        proposal,
        beforeBudget,
        afterBudget,
        acceptedAt: now,
        reviewDueAt:
          request.decision === 'observe'
            ? new Date(
                Date.now() + proposal.observationHours * 3600000,
              ).toISOString()
            : undefined,
        observationPlan:
          request.decision === 'observe'
            ? {
                minSpend: (product.decisionPolicy || DEFAULT_CAMPAIGN_POLICY)
                  .minSpend,
                minInstalls: (product.decisionPolicy || DEFAULT_CAMPAIGN_POLICY)
                  .minInstalls,
                escalation:
                  '到期、主目标恶化或出现新的高消耗问题广告时人工复查，不自动调整预算',
                endCondition:
                  '完整数据达到产品正常范围后由人工结束；缺失数据不视为恢复',
              }
            : undefined,
        baseline: card.snapshot,
      },
    };
    this.database.saveDecisionRecord(order);
    const opened = this.database
      .listActivities(productId, 10000)
      .find(
        (a) =>
          a.action === 'optimizer_viewed' &&
          a.metadata.key === card.key &&
          a.metadata.revision === card.revision,
      );
    this.database.appendActivity({
      caseId: productId,
      action: 'optimizer_decision',
      actor: 'growth',
      detail: '记录人工决策耗时（从首次查看该版本到确认，包含离开页面时间）',
      metadata: {
        key: card.key,
        revision: card.revision,
        orderId: order.id,
        minutes: opened
          ? String(
              Math.max(
                0,
                (Date.parse(now) - Date.parse(opened.createdAt)) / 60000,
              ),
            )
          : '',
      },
    });
    this.database.appendActivity({
      caseId: order.id,
      action: `campaign_${request.decision}`,
      actor: 'growth',
      detail: request.reason.trim(),
      metadata: { revision: card.revision, state: order.status },
    });
    return order;
  }

  async execute(
    id: string,
    request: ExecuteCampaignRequest,
  ): Promise<GrowthDecisionCase> {
    const record: DecisionRecord | undefined =
      this.database.getDecisionRecord(id);
    if (
      !record ||
      'preliminaryJudgment' in record ||
      record.deletedAt ||
      !record.campaignExecution
    )
      throw new NotFoundException('执行单不存在');
    if (
      request?.confirmation !== 'EXECUTED' ||
      typeof request.note !== 'string' ||
      !request.note.trim()
    )
      throw new BadRequestException('请确认已实际执行并填写记录');
    if (record.campaignExecution.state === 'executed') return record;
    if (record.campaignExecution.state !== 'pending')
      throw new ConflictException('该执行单不在待执行状态');
    const now: string = new Date().toISOString();
    const history: CampaignDailySnapshot[] = this.database
      .listCampaignSnapshots(record.productId)
      .filter((s) => s.key === record.campaignExecution!.campaignKey);
    if (!history.length) throw new BadRequestException('缺少执行前快照');
    const card: CampaignDecisionCard = buildCampaignCard(
      this.product(record.productId),
      history,
      [],
    );
    // 这是登记已发生的人工行为，不因数据变化拒绝登记；变化留在执行说明中。
    const updated: GrowthDecisionCase = {
      ...record,
      diagnosticContext: this.context(card),
      executedAt: now,
      baselineValue: campaignMetric(card.snapshot, record.targetMetric),
      campaignExecution: {
        ...record.campaignExecution,
        state: 'executed',
        executedAt: now,
        executionNote: request.note.trim(),
        baseline: card.snapshot,
        reviewDueAt: new Date(
          Date.now() +
            record.campaignExecution.proposal.observationHours * 3600000,
        ).toISOString(),
      },
    };
    this.database.saveDecisionRecord(updated);
    await this.decisions.updateDecision(
      id,
      { action: 'accepted', reason: `实际执行：${request.note.trim()}` },
      'growth',
    );
    this.database.appendActivity({
      caseId: id,
      action: 'campaign_executed',
      actor: 'growth',
      detail: request.note.trim(),
      metadata: {
        executedAt: now,
        baselineDate: card.snapshot.dataDate,
        budgetBefore: String(record.campaignExecution.beforeBudget ?? ''),
        budgetAfter: String(record.campaignExecution.afterBudget ?? ''),
      },
    });
    return this.database.getDecisionRecord(id) as GrowthDecisionCase;
  }

  private context(card: CampaignDecisionCard): GrowthDiagnosticContext {
    const changesPct: GrowthDiagnosticContext['changesPct'] = {};
    for (const key of Object.keys(card.snapshot.metrics)) {
      const current: number | undefined = card.snapshot.metrics[key];
      const previous: number | undefined = card.previous?.metrics[key];
      if (current !== undefined && previous !== undefined && previous !== 0)
        changesPct[key] = (current / previous - 1) * 100;
    }
    return {
      dataDate: card.snapshot.dataDate,
      comparisonDate: card.previous?.dataDate,
      comparisonDays: card.previous ? 1 : 0,
      current: card.snapshot.metrics,
      previousAverage: card.previous?.metrics || {},
      changesPct,
      breakdowns: card.snapshot.breakdowns,
      availableFields: Object.keys(card.snapshot.metrics).filter(
        (k) => card.snapshot.metrics[k] !== undefined,
      ),
      missingFields: [],
      availableDimensions: [
        'campaign',
        ...new Set(card.snapshot.breakdowns.map((b) => b.dimension)),
      ],
      missingDimensions: (
        ['placement', 'age', 'gender', 'audience'] as const
      ).filter(
        (dimension) =>
          !card.snapshot.breakdowns.some((b) => b.dimension === dimension),
      ),
    };
  }
}
