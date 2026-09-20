import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_GROWTH_METRICS,
  LocalDatabaseService,
  type DecisionRecord,
} from '@server/database/local-database.service';
import type {
  CreateProductRequest,
  CreateRecommendationFromJudgmentRequest,
  DeleteGrowthRecordRequest,
  DeleteSkillRuleCandidateRequest,
  GrowthDashboardResponse,
  GrowthDashboardSummary,
  GrowthDecisionCase,
  GrowthDecisionHistoryResponse,
  GrowthDeletionResult,
  GrowthJudgment,
  GrowthHistoryResetResult,
  GrowthMonitoringHistoryResponse,
  GrowthMonitoringSnapshot,
  GrowthMavisJob,
  GrowthProduct,
  IngestDecisionCaseRequest,
  IngestJudgmentRequest,
  ReviewJudgmentRequest,
  UpdateDecisionRequest,
  UpdateMetricStandardsRequest,
  UpdateRecordFocusRequest,
  UpdateResultRequest,
} from '@shared/api.interface';

import { buildSkillRecommendation } from './growth-recommendation-rule';

@Injectable()
export class GrowthDecisionService {
  constructor(private readonly database: LocalDatabaseService) {}

  async getDashboard(): Promise<GrowthDashboardResponse> {
    const products: GrowthProduct[] = this.database.listProducts();
    const records: DecisionRecord[] = this.database.listDecisionRecords();
    const judgments: GrowthJudgment[] = records.filter(
      (record: DecisionRecord): record is GrowthJudgment =>
        this.isJudgmentRecord(record) && !record.campaignReview,
    );
    const cases: GrowthDecisionCase[] = records.filter(
      (record: DecisionRecord): record is GrowthDecisionCase =>
        !this.isJudgmentRecord(record),
    );

    return {
      summary: this.buildSummary(products, cases, judgments),
      products,
      judgments,
      cases,
    };
  }

  resetHistory(): GrowthHistoryResetResult {
    return this.database.resetGrowthHistory();
  }

  getMonitoringHistory(id: string): GrowthMonitoringHistoryResponse {
    if (!this.database.getDecisionRecord(id)) {
      throw new NotFoundException('决策记录不存在');
    }
    return { items: this.database.listMonitoringSnapshots(id) };
  }

  async getHourlyMaintenanceStatus(): Promise<Record<string, number>> {
    const dashboard: GrowthDashboardResponse = await this.getDashboard();
    const now: number = Date.now();
    const staleProducts: GrowthProduct[] = dashboard.products.filter(
      (product: GrowthProduct): boolean => {
        if (!product.lastSyncAt) return true;
        const delayMs: number = product.dataDelayMinutes * 2 * 60 * 1000;
        return now - new Date(product.lastSyncAt).getTime() > delayMs;
      },
    );
    const readyForEvaluation: GrowthDecisionCase[] = dashboard.cases.filter(
      (item: GrowthDecisionCase): boolean =>
        Boolean(item.observationEndsAt) &&
        new Date(item.observationEndsAt || 0).getTime() <= now &&
        item.status !== 'completed',
    );
    return {
      products: dashboard.products.length,
      staleProducts: staleProducts.length,
      pendingDecisions: dashboard.summary.pendingDecisions,
      pendingJudgments: dashboard.summary.pendingJudgments,
      readyForEvaluation: readyForEvaluation.length,
    };
  }

  async getWeeklyReviewMetrics(): Promise<Record<string, number>> {
    const dashboard: GrowthDashboardResponse = await this.getDashboard();
    const rejected: GrowthDecisionCase[] = dashboard.cases.filter(
      (item: GrowthDecisionCase): boolean => item.status === 'rejected',
    );
    const negative: GrowthDecisionCase[] = dashboard.cases.filter(
      (item: GrowthDecisionCase): boolean =>
        item.resultClassification === 'negative',
    );
    return {
      totalRecommendations: dashboard.cases.length,
      pendingDecisions: dashboard.summary.pendingDecisions,
      acceptedRecommendations: dashboard.summary.acceptedRecommendations,
      rejectedRecommendations: rejected.length,
      completedExperiments: dashboard.summary.completedExperiments,
      negativeExperiments: negative.length,
      expectedImprovementRate: dashboard.summary.expectedImprovementRate,
      confirmedJudgments: dashboard.summary.confirmedJudgments,
      pendingJudgments: dashboard.summary.pendingJudgments,
    };
  }

  async ingestJudgment(
    request: IngestJudgmentRequest,
    userId: string,
  ): Promise<GrowthJudgment> {
    const product: GrowthProduct = this.getProduct(request.productId);
    const now: string = new Date().toISOString();
    const judgment: GrowthJudgment = {
      id: randomUUID(),
      productId: request.productId,
      productName: product.name,
      anomalyType: request.anomalyType,
      severity: request.severity,
      status: 'judgment_pending',
      channel: request.channel,
      adAccountId: request.adAccountId,
      campaignId: request.campaignId,
      campaignName: request.campaignName,
      adsetId: request.adsetId,
      adsetName: request.adsetName,
      audienceId: request.audienceId,
      audienceName: request.audienceName,
      adId: request.adId,
      adName: request.adName,
      creativeId: request.creativeId,
      creativeName: request.creativeName,
      targetMetric: request.targetMetric,
      currentValue: request.currentValue,
      baselineValue: request.baselineValue,
      deviationPct: request.deviationPct,
      metricValues: request.metricValues,
      diagnosticContext: request.diagnosticContext,
      spend: request.spend,
      evidence: request.evidence,
      rootCause: request.rootCause,
      confidence: request.confidence,
      preliminaryJudgment: request.preliminaryJudgment,
      skillRuleCandidate: request.skillRuleCandidate,
      createdAt: now,
    };
    this.database.saveDecisionRecord(judgment);
    this.touchProduct(product, now);
    this.database.appendActivity({
      caseId: judgment.id,
      action: 'judgment_ingested',
      actor: userId || 'Doris analysis',
      detail: request.preliminaryJudgment,
      metadata: { source: 'doris_mcp', nextStatus: 'judgment_pending' },
    });
    return judgment;
  }

  async reviewJudgment(
    id: string,
    request: ReviewJudgmentRequest,
    actor: string,
  ): Promise<GrowthJudgment> {
    const current: GrowthJudgment = this.getJudgment(id);
    const canStartReview: boolean =
      current.status === 'judgment_pending' ||
      current.status === 'judgment_deferred';
    const canResolveObservation: boolean =
      current.status === 'judgment_observing' && request.action === 'resolved';
    if (!canStartReview && !canResolveObservation) {
      throw new BadRequestException('该判断已完成审核');
    }
    if (canResolveObservation && !current.observationRecoveryReadyAt) {
      throw new BadRequestException(
        '目标指标尚未连续 24 小时回归正常范围，暂不能移出观察队列',
      );
    }
    const now: string = new Date().toISOString();
    const nextStatus: string =
      request.action === 'resolved'
        ? 'judgment_observation_resolved'
        : `judgment_${request.action}`;
    const updated: GrowthJudgment = {
      ...current,
      status: nextStatus,
      reviewReason: request.reason,
      reviewedBy: actor,
      reviewedAt: now,
      observationStartedAt:
        request.action === 'observing'
          ? current.observationStartedAt || now
          : current.observationStartedAt,
      observationResolvedAt:
        request.action === 'resolved' ? now : current.observationResolvedAt,
      skillRuleCandidate:
        request.skillRuleCandidate || current.skillRuleCandidate,
      skillCandidateDeletedAt: request.skillRuleCandidate
        ? undefined
        : current.skillCandidateDeletedAt,
      skillCandidateDeletedBy: request.skillRuleCandidate
        ? undefined
        : current.skillCandidateDeletedBy,
      skillCandidateDeletionReason: request.skillRuleCandidate
        ? undefined
        : current.skillCandidateDeletionReason,
    };
    this.database.saveDecisionRecord(updated);
    if (request.action === 'observing') {
      this.saveObservationBaseline(updated, now);
    }
    this.database.appendActivity({
      caseId: id,
      action: nextStatus,
      actor,
      detail: request.reason,
      metadata: {
        previousStatus: current.status,
        nextStatus,
        source: 'human_judgment_review',
      },
    });
    return updated;
  }

  async createRecommendationFromJudgment(
    id: string,
    request: CreateRecommendationFromJudgmentRequest,
    userId: string,
  ): Promise<GrowthDecisionCase> {
    const judgment: GrowthJudgment = this.getJudgment(id);
    if (judgment.status !== 'judgment_confirmed') {
      throw new BadRequestException('只有已确认的判断可以生成调整建议');
    }
    if (judgment.recommendationCaseId) {
      return this.getCase(judgment.recommendationCaseId);
    }
    const created: GrowthDecisionCase = {
      id: randomUUID(),
      productId: judgment.productId,
      productName: judgment.productName,
      anomalyType: judgment.anomalyType,
      severity: judgment.severity,
      status: 'pending',
      channel: judgment.channel,
      adAccountId: judgment.adAccountId,
      campaignId: judgment.campaignId,
      campaignName: judgment.campaignName,
      adsetId: judgment.adsetId,
      adsetName: judgment.adsetName,
      audienceId: judgment.audienceId,
      audienceName: judgment.audienceName,
      adId: judgment.adId,
      adName: judgment.adName,
      creativeId: judgment.creativeId,
      creativeName: judgment.creativeName,
      targetMetric: judgment.targetMetric,
      currentValue: judgment.currentValue,
      baselineValue: judgment.baselineValue,
      deviationPct: judgment.deviationPct,
      metricValues: judgment.metricValues,
      diagnosticContext: judgment.diagnosticContext,
      spend: judgment.spend,
      sourceJudgmentId: judgment.id,
      evidence: judgment.aiAnalysis
        ? [judgment.evidence, ...judgment.aiAnalysis.evidence].join('；')
        : judgment.evidence,
      rootCause: judgment.aiAnalysis?.primaryCause || judgment.rootCause,
      confidence: judgment.aiAnalysis?.confidence || judgment.confidence,
      recommendation: request.recommendation,
      recommendedAction: request.recommendedAction,
      expectedImpact: request.expectedImpact,
      riskNote: request.riskNote,
      isFocused: judgment.isFocused,
      focusedAt: judgment.focusedAt,
      focusedBy: judgment.focusedBy,
      createdAt: new Date().toISOString(),
    };
    this.database.saveDecisionRecord(created);
    this.database.saveDecisionRecord({
      ...judgment,
      recommendationCaseId: created.id,
      recommendationCreatedAt: created.createdAt,
    });
    this.database.appendActivity({
      caseId: created.id,
      action: 'recommendation_created',
      actor: userId || 'Growth Agent',
      detail: request.recommendation,
      metadata: { source: 'confirmed_judgment', requestId: id },
    });
    this.database.appendActivity({
      caseId: judgment.id,
      action: 'recommendation_created',
      actor: userId || 'Growth Agent',
      detail: request.recommendation,
      metadata: {
        source: 'confirmed_judgment',
        recommendationCaseId: created.id,
      },
    });
    return created;
  }

  async generateRecommendationFromSkill(
    id: string,
    actor: string,
  ): Promise<GrowthDecisionCase> {
    const judgment: GrowthJudgment = this.getJudgment(id);
    return this.createRecommendationFromJudgment(
      id,
      buildSkillRecommendation(judgment),
      actor,
    );
  }

  async getDecisionHistory(id: string): Promise<GrowthDecisionHistoryResponse> {
    if (!this.database.getDecisionRecord(id)) {
      throw new NotFoundException('决策记录不存在');
    }
    return { items: this.database.listActivities(id) };
  }

  deleteRecord(
    id: string,
    request: DeleteGrowthRecordRequest,
    actor: string,
  ): GrowthDeletionResult {
    const current: DecisionRecord | undefined =
      this.database.getDecisionRecord(id);
    if (!current) throw new NotFoundException('决策记录不存在');
    if (current.deletedAt) throw new BadRequestException('该记录已经删除');
    if (request.confirmation !== 'DELETE_RECORD') {
      throw new BadRequestException('二次确认信息不正确');
    }
    const reason: string = request.reason.trim();
    if (reason.length < 2) {
      throw new BadRequestException('请填写删除原因');
    }
    const deletedAt: string = new Date().toISOString();
    this.database.saveDecisionRecord({
      ...current,
      deletedAt,
      deletedBy: actor,
      deletionReason: reason,
    });
    const relatedJobs: GrowthMavisJob[] = this.database
      .listMavisJobs(undefined, 1000)
      .filter(
        (job: GrowthMavisJob): boolean =>
          job.judgmentId === id || Boolean(job.judgmentIds?.includes(id)),
      );
    for (const job of relatedJobs) {
      if (job.status !== 'queued' && job.status !== 'running') continue;
      this.database.saveMavisJob({
        ...job,
        status: 'cancelled',
        completedAt: deletedAt,
        error: '关联异常已由 Growth 用户删除并归档',
      });
    }
    this.database.appendActivity({
      caseId: id,
      action: 'record_deleted',
      actor,
      detail: reason,
      metadata: {
        source: 'growth_manual_delete',
        recordType: this.isJudgmentRecord(current) ? 'judgment' : 'case',
        archived: 'true',
      },
    });
    return { id, deletedAt, archived: true };
  }

  deleteSkillRuleCandidate(
    id: string,
    request: DeleteSkillRuleCandidateRequest,
    actor: string,
  ): GrowthJudgment {
    const current: GrowthJudgment = this.getJudgment(id);
    if (request.confirmation !== 'DELETE_SKILL_CANDIDATE') {
      throw new BadRequestException('二次确认信息不正确');
    }
    if (!current.skillRuleCandidate) {
      throw new BadRequestException('该异常没有规则候选');
    }
    const reason: string = request.reason.trim();
    if (reason.length < 2) {
      throw new BadRequestException('请填写删除原因');
    }
    const updated: GrowthJudgment = {
      ...current,
      skillRuleCandidate: undefined,
      skillCandidateDeletedAt: new Date().toISOString(),
      skillCandidateDeletedBy: actor,
      skillCandidateDeletionReason: reason,
    };
    this.database.saveDecisionRecord(updated);
    this.database.appendActivity({
      caseId: id,
      action: 'skill_candidate_deleted',
      actor,
      detail: reason,
      metadata: {
        source: 'growth_manual_delete',
        archivedCandidate: current.skillRuleCandidate,
      },
    });
    return updated;
  }

  async createProduct(
    request: CreateProductRequest,
    userId: string,
  ): Promise<GrowthProduct> {
    const accountIds: string[] = (request.accountIds || [])
      .map((accountId: string): string => accountId.trim())
      .filter(Boolean);
    const product: GrowthProduct = {
      id: randomUUID(),
      name: request.name,
      status: 'active',
      targetMetric: request.targetMetric,
      channel: request.channel,
      accountId: accountIds.length ? accountIds.join(',') : request.accountId,
      accountIds,
      dataDelayMinutes: request.dataDelayMinutes || 60,
      skillVersion: 'product-standard-pending',
      analysisMode: 'product_skill',
      dorisSource: request.dorisSource,
      thresholds: { configuredBy: userId || 'local_operator' },
      metrics: DEFAULT_GROWTH_METRICS,
    };
    this.database.saveProduct(product);
    return product;
  }

  async updateMetricStandards(
    productId: string,
    request: UpdateMetricStandardsRequest,
    actor: string,
  ): Promise<GrowthProduct> {
    const product: GrowthProduct = this.getProduct(productId);
    const requested = new Map(request.metrics.map((item) => [item.key, item]));
    const updatedAt: string = new Date().toISOString();
    const metrics = product.metrics.map((metric) => {
      const input = requested.get(metric.key);
      if (!input) return metric;
      for (const value of [
        input.standardValue,
        input.lowerBound,
        input.upperBound,
      ]) {
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
          throw new BadRequestException(
            `${metric.label} 必须填写大于或等于 0 的数字`,
          );
        }
      }
      if (
        input.lowerBound !== undefined &&
        input.upperBound !== undefined &&
        input.lowerBound > input.upperBound
      ) {
        throw new BadRequestException(`${metric.label} 下界不能高于上界`);
      }
      return {
        ...metric,
        standardValue: input.standardValue,
        lowerBound: input.lowerBound,
        upperBound: input.upperBound,
        anomalyThreshold: undefined,
        updatedAt,
        updatedBy: actor,
      };
    });
    const updated: GrowthProduct = { ...product, metrics };
    this.database.saveProduct(updated);
    return updated;
  }

  async ingestCase(
    request: IngestDecisionCaseRequest,
    userId: string,
  ): Promise<GrowthDecisionCase> {
    const product: GrowthProduct = this.getProduct(request.productId);
    const now: string = new Date().toISOString();
    const created: GrowthDecisionCase = {
      ...request,
      id: randomUUID(),
      productName: product.name,
      status: 'pending',
      createdAt: now,
    };
    this.database.saveDecisionRecord(created);
    this.touchProduct(product, now);
    this.database.appendActivity({
      caseId: created.id,
      action: 'ingested',
      actor: userId || 'Doris ingestion',
      detail: '异常数据、原因分析与行动建议已进入决策队列',
      metadata: { source: 'doris_mcp' },
    });
    return created;
  }

  async updateDecision(
    id: string,
    request: UpdateDecisionRequest,
    actor: string,
  ): Promise<GrowthDecisionCase> {
    const current: GrowthDecisionCase = this.getCase(id);
    if (
      request.action === 'accepted' &&
      current.campaignExecution?.state === 'pending'
    ) {
      throw new BadRequestException('请在系列执行单登记已实际执行后开始观测');
    }
    const now: string = new Date().toISOString();
    if (request.action === 'accepted') {
      this.completeSupersededExperiments(current, now);
    }
    const updated: GrowthDecisionCase = {
      ...current,
      status: request.action,
      campaignExecution:
        current.campaignExecution?.state === 'pending' &&
        request.action === 'rejected'
          ? { ...current.campaignExecution, state: 'rejected' }
          : current.campaignExecution,
      decisionReason: request.reason,
      decidedBy: actor,
      decidedAt: now,
      observationEndsAt: undefined,
      experimentStartedAt:
        request.action === 'accepted' ? now : current.experimentStartedAt,
      experimentExpiresAt: undefined,
      normalSince:
        request.action === 'accepted' ? undefined : current.normalSince,
      recoveryReadyAt:
        request.action === 'accepted' ? undefined : current.recoveryReadyAt,
    };
    this.database.saveDecisionRecord(updated);
    if (request.action === 'accepted') {
      this.saveExperimentBaseline(updated, now);
    }
    this.database.appendActivity({
      caseId: id,
      action: request.action,
      actor,
      detail: request.reason,
      metadata: {
        previousStatus: current.status,
        nextStatus: request.action,
        source: 'human_review',
      },
    });
    return updated;
  }

  async updateResult(
    id: string,
    request: UpdateResultRequest,
    actor: string,
  ): Promise<GrowthDecisionCase> {
    const current: GrowthDecisionCase = this.getCase(id);
    if (
      current.campaignExecution &&
      current.campaignExecution.state !== 'executed'
    ) {
      throw new BadRequestException('尚未登记实际执行，不能记录措施实验结果');
    }
    if (
      !request ||
      !['expected', 'partial', 'neutral', 'negative'].includes(
        request.classification,
      ) ||
      !Number.isFinite(request.actualChangePct) ||
      typeof request.actualResult !== 'string' ||
      !request.actualResult.trim() ||
      request.actualResult.length > 5000
    )
      throw new BadRequestException('请填写有效的结果分类、变化幅度及数据证据');
    const completedAt: string = new Date().toISOString();
    const updated: GrowthDecisionCase = {
      ...current,
      status: 'completed',
      resultClassification: request.classification,
      actualChangePct: request.actualChangePct,
      actualResult: request.actualResult,
      completedAt,
      observationEndedAt: completedAt,
      hideAfterAt: new Date(
        new Date(completedAt).getTime() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
    this.database.saveDecisionRecord(updated);
    this.database.appendActivity({
      caseId: id,
      action: 'result_recorded',
      actor,
      detail: request.actualResult,
      metadata: {
        previousStatus: current.status,
        nextStatus: 'completed',
        source: 'experiment_evaluation',
      },
    });
    return updated;
  }

  private completeSupersededExperiments(
    next: GrowthDecisionCase,
    now: string,
  ): void {
    const active: GrowthDecisionCase[] = this.database
      .listDecisionRecords(5000)
      .filter(
        (record: DecisionRecord): record is GrowthDecisionCase =>
          !this.isJudgmentRecord(record) &&
          record.id !== next.id &&
          record.productId === next.productId &&
          (record.status === 'accepted' || record.status === 'observing') &&
          this.sameAdset(record, next),
      );
    for (const previous of active) {
      const updated: GrowthDecisionCase = {
        ...previous,
        status: 'completed',
        resultClassification: previous.resultClassification || 'neutral',
        actualResult:
          `同一广告组出现新异常并采取新措施，原实验结束观测。` +
          (previous.actualResult ? ` ${previous.actualResult}` : ''),
        completedAt: now,
        observationEndedAt: now,
        hideAfterAt: new Date(
          new Date(now).getTime() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        supersededByCaseId: next.id,
      };
      this.database.saveDecisionRecord(updated);
      this.database.appendActivity({
        caseId: previous.id,
        action: 'experiment_superseded',
        actor: '系统',
        detail: '同一广告组出现新异常和新措施，本次观测自动结束',
        metadata: { supersededByCaseId: next.id },
      });
    }
  }

  private sameAdset(
    left: GrowthDecisionCase,
    right: GrowthDecisionCase,
  ): boolean {
    if (left.adsetId && right.adsetId) return left.adsetId === right.adsetId;
    if (left.adsetName && right.adsetName) {
      return left.adsetName === right.adsetName;
    }
    return Boolean(
      left.campaignId &&
      right.campaignId &&
      left.campaignId === right.campaignId,
    );
  }

  private saveExperimentBaseline(
    item: GrowthDecisionCase,
    observedAt: string,
  ): void {
    const metrics = item.diagnosticContext?.current || {};
    const snapshot: GrowthMonitoringSnapshot = {
      id: randomUUID(),
      recordId: item.id,
      productId: item.productId,
      subjectType: 'experiment',
      observedAt,
      dataDate: item.diagnosticContext?.dataDate || observedAt.slice(0, 10),
      campaignId: item.campaignId,
      campaignName: item.campaignName,
      adsetId: item.adsetId,
      adsetName: item.adsetName,
      metrics,
      previousMetrics: {},
      changesPct: {},
      isWithinNormalRange: false,
      isBaseline: true,
      source: 'decision_baseline',
    };
    this.database.saveMonitoringSnapshot(snapshot);
  }

  private saveObservationBaseline(
    item: GrowthJudgment,
    observedAt: string,
  ): void {
    this.database.saveMonitoringSnapshot({
      id: randomUUID(),
      recordId: item.id,
      productId: item.productId,
      subjectType: 'judgment_observation',
      observedAt,
      dataDate: item.diagnosticContext?.dataDate || observedAt.slice(0, 10),
      campaignId: item.campaignId,
      campaignName: item.campaignName,
      adsetId: item.adsetId,
      adsetName: item.adsetName,
      metrics: item.diagnosticContext?.current || {},
      previousMetrics: {},
      changesPct: {},
      isWithinNormalRange: false,
      isBaseline: true,
      source: 'observation_baseline',
    });
  }

  updateRecordFocus(
    id: string,
    request: UpdateRecordFocusRequest,
    actor: string,
  ): DecisionRecord {
    const current: DecisionRecord | undefined =
      this.database.getDecisionRecord(id);
    if (!current) throw new NotFoundException('决策记录不存在');

    const focusedAt: string | undefined = request.focused
      ? new Date().toISOString()
      : undefined;
    const linkedIds: string[] = this.isJudgmentRecord(current)
      ? [current.id, current.recommendationCaseId].filter(
          (linkedId: string | undefined): linkedId is string =>
            Boolean(linkedId),
        )
      : [current.id, current.sourceJudgmentId].filter(
          (linkedId: string | undefined): linkedId is string =>
            Boolean(linkedId),
        );

    let updatedCurrent: DecisionRecord = current;
    for (const linkedId of linkedIds) {
      const linked: DecisionRecord | undefined =
        this.database.getDecisionRecord(linkedId);
      if (!linked) continue;
      const updated: DecisionRecord = {
        ...linked,
        isFocused: request.focused,
        focusedAt,
        focusedBy: request.focused ? actor : undefined,
      };
      this.database.saveDecisionRecord(updated);
      if (linked.id === current.id) updatedCurrent = updated;
    }
    this.database.appendActivity({
      caseId: current.id,
      action: request.focused ? 'focus_enabled' : 'focus_disabled',
      actor,
      detail: request.focused ? '已设为重点关注并置顶' : '已取消重点关注',
      metadata: {
        source: 'human_focus_toggle',
        focused: String(request.focused),
      },
    });
    return updatedCurrent;
  }

  private getProduct(id: string): GrowthProduct {
    const product: GrowthProduct | undefined = this.database.getProduct(id);
    if (!product) throw new NotFoundException('产品不存在');
    return product;
  }

  private getJudgment(id: string): GrowthJudgment {
    const record: DecisionRecord | undefined =
      this.database.getDecisionRecord(id);
    if (!record) throw new NotFoundException('异常判断不存在');
    if (!this.isJudgmentRecord(record)) {
      throw new BadRequestException('该记录不是异常判断');
    }
    return record;
  }

  private getCase(id: string): GrowthDecisionCase {
    const record: DecisionRecord | undefined =
      this.database.getDecisionRecord(id);
    if (!record) throw new NotFoundException('建议不存在');
    if (this.isJudgmentRecord(record)) {
      throw new BadRequestException('该记录不是调整建议');
    }
    return record;
  }

  private touchProduct(product: GrowthProduct, syncedAt: string): void {
    this.database.saveProduct({ ...product, lastSyncAt: syncedAt });
  }

  private isJudgmentRecord(record: DecisionRecord): record is GrowthJudgment {
    return record.status.startsWith('judgment_');
  }

  private buildSummary(
    products: GrowthProduct[],
    cases: GrowthDecisionCase[],
    judgments: GrowthJudgment[],
  ): GrowthDashboardSummary {
    const completed: GrowthDecisionCase[] = cases.filter(
      (item: GrowthDecisionCase): boolean => item.status === 'completed',
    );
    const improved: GrowthDecisionCase[] = completed.filter(
      (item: GrowthDecisionCase): boolean =>
        item.resultClassification === 'expected' ||
        item.resultClassification === 'partial',
    );
    const decisionMinutes: number[] = cases
      .filter((item: GrowthDecisionCase): boolean => Boolean(item.decidedAt))
      .map((item: GrowthDecisionCase): number => {
        const decidedAt: number = new Date(
          item.decidedAt || item.createdAt,
        ).getTime();
        return Math.max(
          0,
          Math.round((decidedAt - new Date(item.createdAt).getTime()) / 60000),
        );
      })
      .sort((left: number, right: number): number => left - right);
    const syncTimes: number[] = products
      .filter((product: GrowthProduct): boolean => Boolean(product.lastSyncAt))
      .map((product: GrowthProduct): number =>
        new Date(product.lastSyncAt || 0).getTime(),
      );

    return {
      openAnomalies: judgments.filter(
        (item: GrowthJudgment): boolean =>
          item.status === 'judgment_pending' ||
          item.status === 'judgment_deferred',
      ).length,
      pendingJudgments: judgments.filter(
        (item: GrowthJudgment): boolean =>
          item.status === 'judgment_pending' ||
          item.status === 'judgment_deferred',
      ).length,
      confirmedJudgments: judgments.filter(
        (item: GrowthJudgment): boolean => item.status === 'judgment_confirmed',
      ).length,
      pendingDecisions: cases.filter(
        (item: GrowthDecisionCase): boolean => item.status === 'pending',
      ).length,
      acceptedRecommendations: cases.filter(
        (item: GrowthDecisionCase): boolean =>
          item.status === 'accepted' || item.status === 'completed',
      ).length,
      completedExperiments: completed.length,
      expectedImprovementRate: completed.length
        ? Math.round((improved.length / completed.length) * 100)
        : 0,
      medianDecisionMinutes: decisionMinutes.length
        ? decisionMinutes[Math.floor(decisionMinutes.length / 2)]
        : 0,
      lastDataSyncAt: syncTimes.length
        ? new Date(Math.max(...syncTimes)).toISOString()
        : undefined,
    };
  }
}
