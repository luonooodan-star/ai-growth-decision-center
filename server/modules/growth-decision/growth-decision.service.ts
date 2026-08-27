import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { desc, eq } from 'drizzle-orm';

import {
  decisionActivity,
  decisionCase,
  productProfile,
} from '@server/database/schema';
import type {
  CreateProductRequest,
  GrowthDashboardResponse,
  GrowthDashboardSummary,
  GrowthDecisionCase,
  GrowthProduct,
  IngestDecisionCaseRequest,
  RecommendedAction,
  UpdateDecisionRequest,
  UpdateResultRequest,
} from '@shared/api.interface';

type DecisionCaseRow = typeof decisionCase.$inferSelect;
type ProductRow = typeof productProfile.$inferSelect;

@Injectable()
export class GrowthDecisionService {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase,
  ) {}

  async getDashboard(): Promise<GrowthDashboardResponse> {
    const products: ProductRow[] = await this.db
      .select()
      .from(productProfile)
      .orderBy(desc(productProfile.updatedAt));
    const cases: DecisionCaseRow[] = await this.db
      .select()
      .from(decisionCase)
      .orderBy(desc(decisionCase.createdAt))
      .limit(200);
    const productNames: Map<string, string> = new Map(
      products.map((product: ProductRow): [string, string] => [
        product.id,
        product.name,
      ]),
    );
    const mappedCases: GrowthDecisionCase[] = cases.map(
      (item: DecisionCaseRow): GrowthDecisionCase =>
        this.mapCase(item, productNames.get(item.productId) || '未知产品'),
    );

    return {
      summary: this.buildSummary(products, mappedCases),
      products: products.map(
        (product: ProductRow): GrowthProduct => this.mapProduct(product),
      ),
      cases: mappedCases,
    };
  }

  async getHourlyMaintenanceStatus(): Promise<Record<string, number>> {
    const dashboard: GrowthDashboardResponse = await this.getDashboard();
    const now: number = Date.now();
    const staleProducts: GrowthProduct[] = dashboard.products.filter(
      (product: GrowthProduct): boolean => {
        if (!product.lastSyncAt) {
          return true;
        }
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
    };
  }

  async createProduct(
    request: CreateProductRequest,
    userId: string,
  ): Promise<GrowthProduct> {
    const rows: ProductRow[] = await this.db
      .insert(productProfile)
      .values({
        name: request.name,
        targetMetric: request.targetMetric,
        channel: request.channel,
        accountId: request.accountId,
        dorisSource: request.dorisSource,
        dataDelayMinutes: request.dataDelayMinutes || 60,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const product: ProductRow | undefined = rows[0];
    if (!product) {
      throw new NotFoundException('产品创建失败');
    }
    return this.mapProduct(product);
  }

  async ingestCase(
    request: IngestDecisionCaseRequest,
    userId: string,
  ): Promise<GrowthDecisionCase> {
    const product: ProductRow = await this.getProduct(request.productId);
    const rows: DecisionCaseRow[] = await this.db
      .insert(decisionCase)
      .values({
        ...request,
        currentValue: this.toNumeric(request.currentValue),
        baselineValue: this.toNumeric(request.baselineValue),
        deviationPct: this.toNumeric(request.deviationPct),
        confidence: String(request.confidence),
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const created: DecisionCaseRow | undefined = rows[0];
    if (!created) {
      throw new NotFoundException('异常案例写入失败');
    }
    await this.db.insert(decisionActivity).values({
      caseId: created.id,
      action: 'ingested',
      actor: 'Doris ingestion',
      detail: '异常数据、原因分析与行动建议已进入决策队列',
      metadata: { source: 'doris_mcp' },
      createdBy: userId,
      updatedBy: userId,
    });
    return this.mapCase(created, product.name);
  }

  async updateDecision(
    id: string,
    request: UpdateDecisionRequest,
    actor: string,
  ): Promise<GrowthDecisionCase> {
    const current: DecisionCaseRow = await this.getCase(id);
    const now: Date = new Date();
    const nextStatus: string = request.action;
    const observationEndsAt: Date | undefined =
      request.action === 'accepted'
        ? new Date(now.getTime() + 72 * 60 * 60 * 1000)
        : undefined;
    const rows: DecisionCaseRow[] = await this.db
      .update(decisionCase)
      .set({
        status: nextStatus,
        decisionReason: request.reason,
        decidedBy: actor,
        decidedAt: now,
        observationEndsAt,
        updatedAt: now,
      })
      .where(eq(decisionCase.id, id))
      .returning();
    const updated: DecisionCaseRow | undefined = rows[0];
    if (!updated) {
      throw new NotFoundException('建议不存在');
    }
    await this.db.insert(decisionActivity).values({
      caseId: id,
      action: nextStatus,
      actor,
      detail: request.reason,
      metadata: {
        previousStatus: current.status,
        nextStatus,
        source: 'human_review',
      },
    });
    const product: ProductRow = await this.getProduct(updated.productId);
    return this.mapCase(updated, product.name);
  }

  async updateResult(
    id: string,
    request: UpdateResultRequest,
    actor: string,
  ): Promise<GrowthDecisionCase> {
    const current: DecisionCaseRow = await this.getCase(id);
    const rows: DecisionCaseRow[] = await this.db
      .update(decisionCase)
      .set({
        status: 'completed',
        resultClassification: request.classification,
        actualChangePct: String(request.actualChangePct),
        actualResult: request.actualResult,
        updatedAt: new Date(),
      })
      .where(eq(decisionCase.id, id))
      .returning();
    const updated: DecisionCaseRow | undefined = rows[0];
    if (!updated) {
      throw new NotFoundException('实验不存在');
    }
    await this.db.insert(decisionActivity).values({
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
    const product: ProductRow = await this.getProduct(updated.productId);
    return this.mapCase(updated, product.name);
  }

  private async getProduct(id: string): Promise<ProductRow> {
    const rows: ProductRow[] = await this.db
      .select()
      .from(productProfile)
      .where(eq(productProfile.id, id))
      .limit(1);
    const product: ProductRow | undefined = rows[0];
    if (!product) {
      throw new NotFoundException('产品不存在');
    }
    return product;
  }

  private async getCase(id: string): Promise<DecisionCaseRow> {
    const rows: DecisionCaseRow[] = await this.db
      .select()
      .from(decisionCase)
      .where(eq(decisionCase.id, id))
      .limit(1);
    const item: DecisionCaseRow | undefined = rows[0];
    if (!item) {
      throw new NotFoundException('建议不存在');
    }
    return item;
  }

  private buildSummary(
    products: ProductRow[],
    cases: GrowthDecisionCase[],
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
      .filter(
        (item: GrowthDecisionCase): boolean => Boolean(item.decidedAt),
      )
      .map((item: GrowthDecisionCase): number => {
        const decidedAt: number = new Date(item.decidedAt || item.createdAt).getTime();
        const createdAt: number = new Date(item.createdAt).getTime();
        return Math.max(0, Math.round((decidedAt - createdAt) / 60000));
      })
      .sort((left: number, right: number): number => left - right);
    const medianIndex: number = Math.floor(decisionMinutes.length / 2);
    const lastSyncTimes: number[] = products
      .filter((product: ProductRow): boolean => Boolean(product.lastSyncAt))
      .map((product: ProductRow): number =>
        product.lastSyncAt ? product.lastSyncAt.getTime() : 0,
      );
    const lastDataSyncAt: string | undefined = lastSyncTimes.length
      ? new Date(Math.max(...lastSyncTimes)).toISOString()
      : undefined;

    return {
      openAnomalies: cases.filter(
        (item: GrowthDecisionCase): boolean => item.status !== 'completed',
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
        ? decisionMinutes[medianIndex]
        : 0,
      lastDataSyncAt,
    };
  }

  private mapProduct(product: ProductRow): GrowthProduct {
    return {
      id: product.id,
      name: product.name,
      status: product.status,
      targetMetric: product.targetMetric,
      channel: product.channel,
      accountId: product.accountId || undefined,
      dataDelayMinutes: product.dataDelayMinutes,
      skillVersion: product.skillVersion,
      dorisSource: product.dorisSource || undefined,
      lastSyncAt: product.lastSyncAt?.toISOString(),
    };
  }

  private mapCase(item: DecisionCaseRow, productName: string): GrowthDecisionCase {
    return {
      id: item.id,
      productId: item.productId,
      productName,
      anomalyType: item.anomalyType,
      severity: item.severity,
      status: item.status,
      channel: item.channel,
      campaignId: item.campaignId || undefined,
      campaignName: item.campaignName || undefined,
      adsetId: item.adsetId || undefined,
      adsetName: item.adsetName || undefined,
      audienceId: item.audienceId || undefined,
      audienceName: item.audienceName || undefined,
      adId: item.adId || undefined,
      adName: item.adName || undefined,
      creativeId: item.creativeId || undefined,
      creativeName: item.creativeName || undefined,
      targetMetric: item.targetMetric,
      currentValue: this.toNumber(item.currentValue),
      baselineValue: this.toNumber(item.baselineValue),
      deviationPct: this.toNumber(item.deviationPct),
      evidence: item.evidence,
      rootCause: item.rootCause,
      confidence: Number(item.confidence),
      recommendation: item.recommendation,
      recommendedAction: this.toRecommendedAction(item.recommendedAction),
      expectedImpact: item.expectedImpact,
      riskNote: item.riskNote || undefined,
      decisionReason: item.decisionReason || undefined,
      decidedBy: item.decidedBy || undefined,
      decidedAt: item.decidedAt?.toISOString(),
      executedAt: item.executedAt?.toISOString(),
      observationEndsAt: item.observationEndsAt?.toISOString(),
      resultClassification: item.resultClassification || undefined,
      actualChangePct: this.toNumber(item.actualChangePct),
      actualResult: item.actualResult || undefined,
      createdAt: item.createdAt.toISOString(),
    };
  }

  private toRecommendedAction(value: unknown): RecommendedAction {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const source: Record<string, unknown> = value as Record<string, unknown>;
    return {
      actionType:
        typeof source.actionType === 'string' ? source.actionType : undefined,
      targetLevel:
        typeof source.targetLevel === 'string' ? source.targetLevel : undefined,
      targetId: typeof source.targetId === 'string' ? source.targetId : undefined,
      changePct:
        typeof source.changePct === 'number' ? source.changePct : undefined,
    };
  }

  private toNumeric(value?: number): string | undefined {
    return typeof value === 'number' ? String(value) : undefined;
  }

  private toNumber(value: string | null): number | undefined {
    return value === null ? undefined : Number(value);
  }
}
