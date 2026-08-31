import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  LocalDatabaseService,
  type DecisionRecord,
} from '@server/database/local-database.service';
import type {
  CreateProductRequest,
  CreateRecommendationFromJudgmentRequest,
  GrowthDashboardResponse,
  GrowthDashboardSummary,
  GrowthDecisionCase,
  GrowthJudgment,
  GrowthProduct,
  IngestDecisionCaseRequest,
  IngestJudgmentRequest,
  ReviewJudgmentRequest,
  UpdateDecisionRequest,
  UpdateResultRequest,
} from '@shared/api.interface';

@Injectable()
export class GrowthDecisionService {
  constructor(private readonly database: LocalDatabaseService) {}

  async getDashboard(): Promise<GrowthDashboardResponse> {
    const products: GrowthProduct[] = this.database.listProducts();
    const records: DecisionRecord[] = this.database.listDecisionRecords();
    const judgments: GrowthJudgment[] = records.filter(
      (record: DecisionRecord): record is GrowthJudgment =>
        this.isJudgmentRecord(record),
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
    if (
      current.status !== 'judgment_pending' &&
      current.status !== 'judgment_deferred'
    ) {
      throw new BadRequestException('该判断已完成审核');
    }
    const nextStatus: string = `judgment_${request.action}`;
    const updated: GrowthJudgment = {
      ...current,
      status: nextStatus,
      reviewReason: request.reason,
      reviewedBy: actor,
      reviewedAt: new Date().toISOString(),
      skillRuleCandidate:
        request.skillRuleCandidate || current.skillRuleCandidate,
    };
    this.database.saveDecisionRecord(updated);
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
    const created: GrowthDecisionCase = {
      id: randomUUID(),
      productId: judgment.productId,
      productName: judgment.productName,
      anomalyType: judgment.anomalyType,
      severity: judgment.severity,
      status: 'pending',
      channel: judgment.channel,
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
      evidence: judgment.evidence,
      rootCause: judgment.rootCause,
      confidence: judgment.confidence,
      recommendation: request.recommendation,
      recommendedAction: request.recommendedAction,
      expectedImpact: request.expectedImpact,
      riskNote: request.riskNote,
      createdAt: new Date().toISOString(),
    };
    this.database.saveDecisionRecord(created);
    this.database.appendActivity({
      caseId: created.id,
      action: 'recommendation_created',
      actor: userId || 'Growth Agent',
      detail: request.recommendation,
      metadata: { source: 'confirmed_judgment', requestId: id },
    });
    return created;
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
      dorisSource: request.dorisSource,
      thresholds: { configuredBy: userId || 'local_operator' },
    };
    this.database.saveProduct(product);
    return product;
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
    const now: string = new Date().toISOString();
    const updated: GrowthDecisionCase = {
      ...current,
      status: request.action,
      decisionReason: request.reason,
      decidedBy: actor,
      decidedAt: now,
      observationEndsAt:
        request.action === 'accepted'
          ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
          : undefined,
    };
    this.database.saveDecisionRecord(updated);
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
    const updated: GrowthDecisionCase = {
      ...current,
      status: 'completed',
      resultClassification: request.classification,
      actualChangePct: request.actualChangePct,
      actualResult: request.actualResult,
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
