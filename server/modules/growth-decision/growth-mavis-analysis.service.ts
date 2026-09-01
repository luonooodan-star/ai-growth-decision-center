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
  CompleteGrowthMavisJobRequest,
  FailGrowthMavisJobRequest,
  GrowthAiAnalysis,
  GrowthAiProviderStatus,
  GrowthJudgment,
  GrowthMavisJob,
  GrowthMavisJobContext,
  GrowthMavisJobListResponse,
  GrowthProduct,
} from '@shared/api.interface';

import { buildProductSkillDiagnostic } from './growth-diagnostic-analysis';

const MAVIS_KEYCHAIN_SERVICE = 'ai-growth-decision-center-mavis-mcp';
const LOCAL_WORKER_ID = 'mavis-skill-simulator';

@Injectable()
export class GrowthMavisAnalysisService {
  constructor(private readonly database: LocalDatabaseService) {}

  getStatus(): GrowthAiProviderStatus {
    const jobs: GrowthMavisJob[] = this.database.listMavisJobs(undefined, 1000);
    const runtimeMode: GrowthAiProviderStatus['runtimeMode'] =
      this.runtimeMode();
    const mcpConfigured: boolean = Boolean(this.mcpToken());
    return {
      provider: 'mavis',
      model: process.env.MAVIS_MODEL || 'Marvis Growth Analyst',
      configured: runtimeMode === 'skill_simulation' || mcpConfigured,
      runtimeMode,
      mcpConfigured,
      queuedJobs: jobs.filter(
        (job: GrowthMavisJob): boolean => job.status === 'queued',
      ).length,
      runningJobs: jobs.filter(
        (job: GrowthMavisJob): boolean => job.status === 'running',
      ).length,
      fallbackProvider: 'product_skill',
      fallbackAvailable: true,
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

    if (mode === 'external_only' || this.runtimeMode() === 'external_worker') {
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
    const judgment: GrowthJudgment = this.getJudgment(job.judgmentId);
    return {
      job,
      product,
      judgment,
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

  completeJob(
    id: string,
    request: CompleteGrowthMavisJobRequest,
  ): GrowthJudgment {
    const job: GrowthMavisJob = this.getJob(id);
    this.ensureWorkerOwnsJob(job, request.workerId);
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
    const judgment: GrowthJudgment = this.getJudgment(job.judgmentId);
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

  private saveAnalysis(
    job: GrowthMavisJob,
    analysis: GrowthAiAnalysis,
  ): GrowthJudgment {
    const judgment: GrowthJudgment = this.getJudgment(job.judgmentId);
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

  private validateAnalysis(analysis: CompleteGrowthMavisJobRequest['analysis']): void {
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

  private runtimeMode(): GrowthAiProviderStatus['runtimeMode'] {
    return process.env.MAVIS_WORKER_MODE === 'external'
      ? 'external_worker'
      : 'skill_simulation';
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
