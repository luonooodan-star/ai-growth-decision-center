import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
  LocalDatabaseService,
  type DecisionRecord,
} from '@server/database/local-database.service';
import type {
  CompleteGrowthMavisBatchJobRequest,
  CompleteGrowthMavisJobRequest,
  FailGrowthMavisJobRequest,
  GrowthAiAnalysis,
  GrowthAiProviderStatus,
  GrowthBatchAnalysisResponse,
  GrowthJudgment,
  GrowthMavisJob,
  GrowthMavisJobContext,
  GrowthMavisJobListResponse,
  GrowthProduct,
  GrowthAnalysisMode,
} from '@shared/api.interface';

import { buildProductSkillDiagnostic } from './growth-diagnostic-analysis';

const MAVIS_KEYCHAIN_SERVICE = 'ai-growth-decision-center-mavis-mcp';
const LOCAL_WORKER_ID = 'mavis-skill-simulator';

@Injectable()
export class GrowthMavisAnalysisService {
  constructor(private readonly database: LocalDatabaseService) {}

  getStatus(productId?: string): GrowthAiProviderStatus {
    const jobs: GrowthMavisJob[] = this.database.listMavisJobs(undefined, 1000);
    const selectedMode: GrowthAnalysisMode = productId
      ? this.getProduct(productId).analysisMode || 'product_skill'
      : 'product_skill';
    const runtimeMode: GrowthAiProviderStatus['runtimeMode'] =
      selectedMode === 'marvis_bridge' ? 'external_worker' : 'skill_simulation';
    const mcpConfigured: boolean = Boolean(this.mcpToken());
    const productJobs: GrowthMavisJob[] = productId
      ? jobs.filter(
          (job: GrowthMavisJob): boolean => job.productId === productId,
        )
      : jobs;
    return {
      provider: 'mavis',
      model: process.env.MAVIS_MODEL || 'Marvis Growth Analyst',
      configured: selectedMode === 'product_skill' || mcpConfigured,
      runtimeMode,
      selectedMode,
      mcpConfigured,
      queuedJobs: productJobs.filter(
        (job: GrowthMavisJob): boolean => job.status === 'queued',
      ).length,
      runningJobs: productJobs.filter(
        (job: GrowthMavisJob): boolean => job.status === 'running',
      ).length,
      fallbackProvider: 'product_skill',
      fallbackAvailable: true,
    };
  }

  updateAnalysisMode(
    productId: string,
    mode: GrowthAnalysisMode,
  ): GrowthProduct {
    const product: GrowthProduct = this.getProduct(productId);
    if (!['product_skill', 'marvis_bridge'].includes(mode)) {
      throw new BadRequestException('未知的分析模式');
    }
    this.cancelOpenJobs(productId, '分析模式已切换，旧任务已取消');
    const updated: GrowthProduct = { ...product, analysisMode: mode };
    this.database.saveProduct(updated);
    return updated;
  }

  async analyzeProductBatch(
    productId: string,
  ): Promise<GrowthBatchAnalysisResponse> {
    const product: GrowthProduct = this.getProduct(productId);
    const judgments: GrowthJudgment[] = this.database
      .listDecisionRecords(5000)
      .filter(
        (record): record is GrowthJudgment =>
          'preliminaryJudgment' in record &&
          record.productId === productId &&
          (record.status === 'judgment_pending' ||
            record.status === 'judgment_deferred'),
      );
    if (!judgments.length) {
      return {
        mode: product.analysisMode || 'product_skill',
        analyzedCount: 0,
        message: '当前没有待分析的异常',
      };
    }

    const mode: GrowthAnalysisMode = product.analysisMode || 'product_skill';
    if (mode === 'marvis_bridge' && !this.mcpToken()) {
      throw new BadRequestException(
        'Marvis 任务桥尚未配置 Token，请切换到产品 Skill 或先完成 Marvis 接入',
      );
    }
    this.cancelOpenJobs(productId, '已由新的整批分析任务替代');
    const job: GrowthMavisJob = {
      id: randomUUID(),
      judgmentId: judgments[0].id,
      judgmentIds: judgments.map(
        (judgment: GrowthJudgment): string => judgment.id,
      ),
      productId: product.id,
      productName: product.name,
      jobType: 'batch_anomaly_assessment',
      trigger: 'manual',
      status: 'queued',
      skillVersion: product.skillVersion,
      attempt: 0,
      createdAt: new Date().toISOString(),
    };
    this.database.saveMavisJob(job);
    for (const judgment of judgments) {
      this.database.saveDecisionRecord({
        ...judgment,
        aiAnalysisStatus: 'running',
      });
    }

    if (mode === 'product_skill') {
      for (const judgment of judgments) {
        this.runSkillSimulationForJudgment(job, product, judgment);
      }
      this.database.saveMavisJob({
        ...job,
        status: 'completed',
        workerId: LOCAL_WORKER_ID,
        startedAt: job.createdAt,
        completedAt: new Date().toISOString(),
      });
      return {
        mode,
        analyzedCount: judgments.length,
        job: this.getJob(job.id),
        message: `产品 Skill 已完成 ${judgments.length} 条异常的整批分析`,
      };
    }

    return {
      mode,
      analyzedCount: judgments.length,
      job,
      message: `已创建 1 条 Marvis 整批任务，包含 ${judgments.length} 条异常`,
    };
  }

  listJobs(judgmentId?: string): GrowthMavisJobListResponse {
    return { items: this.database.listMavisJobs(judgmentId) };
  }

  async analyzeJudgment(
    id: string,
    mode: 'default' | 'external_only' = 'default',
    trigger: GrowthMavisJob['trigger'] = 'manual',
  ): Promise<GrowthJudgment> {
    const judgment: GrowthJudgment = this.getJudgment(id);
    const product: GrowthProduct = this.getProduct(judgment.productId);
    if (
      (mode === 'external_only' ||
        (product.analysisMode || 'product_skill') === 'marvis_bridge') &&
      !this.mcpToken()
    ) {
      throw new BadRequestException(
        'Marvis 任务桥尚未配置 Token，请切换到产品 Skill 或先完成 Marvis 接入',
      );
    }
    const existing: GrowthMavisJob | undefined = this.database
      .listMavisJobs(id)
      .find(
        (job: GrowthMavisJob): boolean =>
          job.status === 'queued' || job.status === 'running',
      );
    if (existing) return this.getJudgment(id);

    const job: GrowthMavisJob = {
      id: randomUUID(),
      judgmentId: judgment.id,
      productId: product.id,
      productName: product.name,
      jobType: 'anomaly_assessment',
      trigger,
      status: 'queued',
      skillVersion: product.skillVersion,
      attempt: 0,
      createdAt: new Date().toISOString(),
    };
    this.database.saveMavisJob(job);
    this.database.saveDecisionRecord({
      ...judgment,
      aiAnalysisStatus: 'running',
    });
    this.database.appendActivity({
      caseId: judgment.id,
      action: 'mavis_job_queued',
      actor: 'Marvis Bridge',
      detail: `已创建异常分析任务 ${job.id}`,
      metadata: {
        source: 'mavis',
        requestId: job.id,
        skillVersion: job.skillVersion,
      },
    });

    if (
      mode === 'external_only' ||
      (product.analysisMode || 'product_skill') === 'marvis_bridge'
    ) {
      return this.getJudgment(id);
    }
    return this.runSkillSimulation(job, product, judgment);
  }

  claimNextJob(workerId: string): GrowthMavisJob | undefined {
    if (!workerId.trim()) throw new BadRequestException('workerId 不能为空');
    return this.database.claimNextMavisJob(workerId.trim());
  }

  getJobContext(id: string): GrowthMavisJobContext {
    const job: GrowthMavisJob = this.getJob(id);
    const product: GrowthProduct = this.getProduct(job.productId);
    const judgmentIds: string[] = job.judgmentIds?.length
      ? job.judgmentIds
      : [job.judgmentId];
    const judgments: GrowthJudgment[] = judgmentIds.map(
      (judgmentId: string): GrowthJudgment => this.getJudgment(judgmentId),
    );
    const judgment: GrowthJudgment = judgments[0];
    return {
      job,
      product,
      judgment,
      judgments,
      metricStandards: product.metrics,
      outputContract: {
        judgment: ['confirmed', 'uncertain', 'rejected'],
        confidenceRange: [0, 100],
        observationHoursRange: [1, 168],
        requiredAnalysis: [
          '不能只复述指标库越界；必须解释指标链路和可能原因',
          '对比消耗、ECPM、CTR、IPM、CPI、安装、收入和 ROAS 趋势',
          '使用可用的 Campaign、广告组、国家、版位、年龄和人群拆分',
          '缺失的字段或维度必须明确列为缺口，不能臆测',
          '给出可执行的投放动作、步骤、观察窗口、护栏和回滚条件',
        ],
        supportedActionTypes: [
          'increase_budget',
          'decrease_budget',
          'hold_budget',
          'exclude_target',
          'rotate_creative',
          'create_experiment',
          'observe',
          'investigate_data',
        ],
      },
    };
  }

  completeBatchJob(
    id: string,
    request: CompleteGrowthMavisBatchJobRequest,
  ): GrowthJudgment[] {
    const job: GrowthMavisJob = this.getJob(id);
    this.ensureWorkerOwnsJob(job, request.workerId);
    const expectedIds = new Set(job.judgmentIds || [job.judgmentId]);
    if (
      job.jobType !== 'batch_anomaly_assessment' ||
      request.analyses.length !== expectedIds.size ||
      request.analyses.some((item) => !expectedIds.has(item.judgmentId))
    ) {
      throw new BadRequestException('整批分析结果必须完整对应任务中的异常');
    }
    const generatedAt: string = new Date().toISOString();
    const updated: GrowthJudgment[] = request.analyses.map((item) => {
      this.validateAnalysis(item.analysis);
      return this.saveAnalysis(
        job,
        {
          provider: 'mavis',
          model: request.model.trim() || 'Marvis Growth Analyst',
          ...item.analysis,
          confidence: Math.round(item.analysis.confidence),
          observationHours: Math.round(item.analysis.observationHours),
          generatedAt,
        },
        item.judgmentId,
      );
    });
    this.database.saveMavisJob({
      ...job,
      status: 'completed',
      completedAt: generatedAt,
      error: undefined,
    });
    return updated;
  }

  completeJob(
    id: string,
    request: CompleteGrowthMavisJobRequest,
  ): GrowthJudgment {
    const job: GrowthMavisJob = this.getJob(id);
    this.ensureWorkerOwnsJob(job, request.workerId);
    if (job.jobType === 'batch_anomaly_assessment') {
      throw new BadRequestException(
        '整批任务必须使用 submit_batch_analysis 一次回写全部异常',
      );
    }
    this.validateAnalysis(request.analysis);
    const analysis: GrowthAiAnalysis = {
      provider: 'mavis',
      model: request.model.trim() || 'Marvis Growth Analyst',
      ...request.analysis,
      confidence: Math.round(request.analysis.confidence),
      observationHours: Math.round(request.analysis.observationHours),
      generatedAt: new Date().toISOString(),
    };
    const judgment: GrowthJudgment = this.saveAnalysis(job, analysis);
    const completed: GrowthMavisJob = {
      ...job,
      status: 'completed',
      workerId: request.workerId,
      completedAt: analysis.generatedAt,
      error: undefined,
    };
    this.database.saveMavisJob(completed);
    return judgment;
  }

  failJob(id: string, request: FailGrowthMavisJobRequest): GrowthMavisJob {
    const job: GrowthMavisJob = this.getJob(id);
    this.ensureWorkerOwnsJob(job, request.workerId);
    const failed: GrowthMavisJob = {
      ...job,
      status: 'failed',
      workerId: request.workerId,
      error: request.error.trim() || 'Marvis Worker 未返回错误详情',
      completedAt: new Date().toISOString(),
    };
    this.database.saveMavisJob(failed);
    for (const judgmentId of job.judgmentIds || [job.judgmentId]) {
      const judgment: GrowthJudgment = this.getJudgment(judgmentId);
      this.database.saveDecisionRecord({
        ...judgment,
        aiAnalysisStatus: 'failed',
      });
      this.database.appendActivity({
        caseId: judgment.id,
        action: 'mavis_analysis_failed',
        actor: request.workerId,
        detail: failed.error || 'Marvis 分析失败',
        metadata: { source: 'mavis', requestId: job.id },
      });
    }
    return failed;
  }

  authorize(token?: string): void {
    const expected: string = this.mcpToken();
    const provided: string = token?.trim() || '';
    if (!expected || !provided || !this.safeEqual(expected, provided)) {
      throw new UnauthorizedException('Marvis MCP Token 无效或未配置');
    }
  }

  private runSkillSimulation(
    queuedJob: GrowthMavisJob,
    product: GrowthProduct,
    judgment: GrowthJudgment,
  ): GrowthJudgment {
    const running: GrowthMavisJob = {
      ...queuedJob,
      status: 'running',
      workerId: LOCAL_WORKER_ID,
      attempt: queuedJob.attempt + 1,
      startedAt: new Date().toISOString(),
    };
    this.database.saveMavisJob(running);
    const analysis: GrowthAiAnalysis = {
      provider: 'product_skill',
      model: `${product.name} Product Skill Diagnostic`,
      ...buildProductSkillDiagnostic(product, judgment),
      fallbackReason:
        '当前未运行外部 Marvis Worker，已使用产品 Skill 诊断引擎；结果不会冒充 Marvis 模型分析。',
      generatedAt: new Date().toISOString(),
    };
    const updated: GrowthJudgment = this.saveAnalysis(running, analysis);
    this.database.saveMavisJob({
      ...running,
      status: 'completed',
      completedAt: analysis.generatedAt,
    });
    return updated;
  }

  private runSkillSimulationForJudgment(
    job: GrowthMavisJob,
    product: GrowthProduct,
    judgment: GrowthJudgment,
  ): GrowthJudgment {
    const analysis: GrowthAiAnalysis = {
      provider: 'product_skill',
      model: `${product.name} Product Skill Diagnostic`,
      ...buildProductSkillDiagnostic(product, judgment),
      generatedAt: new Date().toISOString(),
    };
    return this.saveAnalysis(job, analysis, judgment.id);
  }

  private saveAnalysis(
    job: GrowthMavisJob,
    analysis: GrowthAiAnalysis,
    judgmentId: string = job.judgmentId,
  ): GrowthJudgment {
    const judgment: GrowthJudgment = this.getJudgment(judgmentId);
    const updated: GrowthJudgment = {
      ...judgment,
      aiAnalysisStatus: 'completed',
      aiAnalysis: analysis,
    };
    this.database.saveDecisionRecord(updated);
    this.database.appendActivity({
      caseId: judgment.id,
      action: 'mavis_analysis_completed',
      actor: analysis.model,
      detail: analysis.summary,
      metadata: {
        source: 'mavis',
        requestId: job.id,
        judgment: analysis.judgment,
        confidence: String(analysis.confidence),
      },
    });
    return updated;
  }

  private cancelOpenJobs(productId: string, reason: string): void {
    const completedAt: string = new Date().toISOString();
    const jobs: GrowthMavisJob[] = this.database
      .listMavisJobs(undefined, 5000)
      .filter(
        (job: GrowthMavisJob): boolean =>
          job.productId === productId &&
          (job.status === 'queued' || job.status === 'running'),
      );
    for (const job of jobs) {
      this.database.saveMavisJob({
        ...job,
        status: 'cancelled',
        error: reason,
        completedAt,
      });
      for (const judgmentId of job.judgmentIds || [job.judgmentId]) {
        const judgment: GrowthJudgment = this.getJudgment(judgmentId);
        this.database.saveDecisionRecord({
          ...judgment,
          aiAnalysisStatus: undefined,
        });
      }
    }
  }

  private getJudgment(id: string): GrowthJudgment {
    const record: DecisionRecord | undefined =
      this.database.getDecisionRecord(id);
    if (!record || !('preliminaryJudgment' in record)) {
      throw new NotFoundException('异常判断不存在');
    }
    return record;
  }

  private getProduct(id: string): GrowthProduct {
    const product: GrowthProduct | undefined = this.database.getProduct(id);
    if (!product) throw new NotFoundException('产品不存在');
    return product;
  }

  private getJob(id: string): GrowthMavisJob {
    const job: GrowthMavisJob | undefined = this.database.getMavisJob(id);
    if (!job) throw new NotFoundException('Marvis 分析任务不存在');
    return job;
  }

  private ensureWorkerOwnsJob(job: GrowthMavisJob, workerId: string): void {
    if (job.status !== 'running') {
      throw new BadRequestException('Marvis 分析任务当前不可回写');
    }
    if (!workerId.trim() || job.workerId !== workerId.trim()) {
      throw new BadRequestException('该任务未由当前 Marvis Worker 领取');
    }
  }

  private validateAnalysis(
    analysis: CompleteGrowthMavisJobRequest['analysis'],
  ): void {
    const metricLists: string[][] = [
      analysis.evidence,
      analysis.alternativeCauses,
    ];
    if (
      !['confirmed', 'uncertain', 'rejected'].includes(analysis.judgment) ||
      !analysis.summary.trim() ||
      !analysis.primaryCause.trim() ||
      !analysis.recommendedNextStep.trim() ||
      !analysis.risk.trim() ||
      metricLists.some(
        (items: string[]): boolean =>
          !Array.isArray(items) ||
          items.some((item: string): boolean => !item.trim()),
      ) ||
      !Number.isFinite(analysis.confidence) ||
      analysis.confidence < 0 ||
      analysis.confidence > 100 ||
      !Number.isInteger(analysis.observationHours) ||
      analysis.observationHours < 1 ||
      analysis.observationHours > 168 ||
      (analysis.recommendedActions !== undefined &&
        (!Array.isArray(analysis.recommendedActions) ||
          analysis.recommendedActions.some(
            (action): boolean =>
              !action.actionType ||
              !action.targetLevel ||
              !action.targetId.trim() ||
              !action.rationale.trim() ||
              !action.rollbackCondition.trim() ||
              !Array.isArray(action.steps) ||
              !action.steps.length ||
              !Array.isArray(action.guardrails) ||
              action.observationHours < 1 ||
              action.observationHours > 168,
          )))
    ) {
      throw new BadRequestException('Marvis 分析结果不符合结构化输出合同');
    }
  }

  private mcpToken(): string {
    if (process.env.MAVIS_MCP_TOKEN) return process.env.MAVIS_MCP_TOKEN;
    try {
      return execFileSync(
        'security',
        [
          'find-generic-password',
          '-a',
          process.env.USER || '',
          '-s',
          MAVIS_KEYCHAIN_SERVICE,
          '-w',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    } catch {
      return '';
    }
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer: Buffer = Buffer.from(left);
    const rightBuffer: Buffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }
}
