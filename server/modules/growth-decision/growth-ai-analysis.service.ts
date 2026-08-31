import { HttpService } from '@nestjs/axios';
import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { lastValueFrom } from 'rxjs';

import {
  LocalDatabaseService,
  type DecisionRecord,
} from '@server/database/local-database.service';
import type {
  GrowthAiAnalysis,
  GrowthAiJudgment,
  GrowthAiProviderStatus,
  GrowthJudgment,
  GrowthMetricDefinition,
  GrowthProduct,
} from '@shared/api.interface';

interface GlmAnalysisPayload {
  judgment: GrowthAiJudgment;
  summary: string;
  primaryCause: string;
  evidence: string[];
  alternativeCauses: string[];
  recommendedNextStep: string;
  risk: string;
  confidence: number;
  observationHours: number;
}

interface GlmChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const GLM_DEFAULT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const GLM_DEFAULT_MODEL = 'glm-4.7-flash';
const GLM_KEYCHAIN_SERVICE = 'ai-growth-decision-center-glm';

@Injectable()
export class GrowthAiAnalysisService {
  private readonly logger: Logger = new Logger(GrowthAiAnalysisService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly database: LocalDatabaseService,
  ) {}

  getStatus(): GrowthAiProviderStatus {
    return {
      provider: 'glm',
      model: this.model(),
      configured: Boolean(this.apiKey()),
      fallbackProvider: 'product_skill',
      fallbackAvailable: true,
    };
  }

  async analyzeJudgment(
    id: string,
    mode: 'default' | 'glm_only' = 'default',
  ): Promise<GrowthJudgment> {
    const record: DecisionRecord | undefined =
      this.database.getDecisionRecord(id);
    if (!record || !('preliminaryJudgment' in record)) {
      throw new NotFoundException('异常判断不存在');
    }
    const product: GrowthProduct | undefined = this.database.getProduct(
      record.productId,
    );
    if (!product) throw new NotFoundException('产品不存在');

    this.saveAnalysisStatus(record, 'running');
    const apiKey: string = this.apiKey();
    if (!apiKey) {
      if (mode === 'glm_only') {
        const message: string = 'GLM API Key 未配置';
        this.saveAnalysisFailure(record, message);
        throw new ServiceUnavailableException(message);
      }
      return this.saveSkillFallback(record, product, 'GLM API Key 未配置');
    }

    try {
      const model: string = this.model();
      const payload: GlmAnalysisPayload = await this.requestAnalysis(
        apiKey,
        model,
        product,
        record,
      );
      return this.saveAnalysis(record, {
        provider: 'glm',
        model,
        ...payload,
        confidence: Math.round(payload.confidence),
        observationHours: Math.round(payload.observationHours),
        generatedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      if (mode === 'glm_only') {
        const friendlyMessage: string = this.friendlyGlmError(message);
        this.saveAnalysisFailure(record, friendlyMessage);
        throw new BadGatewayException(friendlyMessage);
      }
      this.logger.warn(`GLM 不可用，已降级到产品 Skill：${message}`);
      return this.saveSkillFallback(record, product, message);
    }
  }

  private async requestAnalysis(
    apiKey: string,
    model: string,
    product: GrowthProduct,
    judgment: GrowthJudgment,
  ): Promise<GlmAnalysisPayload> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await lastValueFrom(
          this.httpService.post<GlmChatResponse>(
            process.env.GLM_API_URL || GLM_DEFAULT_URL,
            {
              model,
              messages: [
                { role: 'system', content: this.systemPrompt() },
                {
                  role: 'user',
                  content: JSON.stringify(
                    this.analysisContext(product, judgment),
                  ),
                },
              ],
              thinking: { type: 'enabled' },
              response_format: { type: 'json_object' },
              temperature: 0.1,
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              signal: AbortSignal.timeout(60_000),
            },
          ),
        );
        const content: string | undefined =
          response.data.choices?.[0]?.message?.content;
        if (!content) throw new Error('GLM 未返回分析内容');
        const parsed: unknown = this.parseJson(content);
        if (!this.isAnalysisPayload(parsed)) {
          throw new Error('GLM 返回结果不符合分析结构');
        }
        return parsed;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`GLM 第 ${attempt} 次分析失败：${lastError.message}`);
        if (attempt < 2) {
          await new Promise<void>((resolve: () => void): void => {
            setTimeout(resolve, 3_000);
          });
        }
      }
    }
    throw lastError || new Error('GLM 分析失败');
  }

  private saveAnalysis(
    judgment: GrowthJudgment,
    analysis: GrowthAiAnalysis,
  ): GrowthJudgment {
    const currentRecord: DecisionRecord | undefined =
      this.database.getDecisionRecord(judgment.id);
    const currentJudgment: GrowthJudgment =
      currentRecord && 'preliminaryJudgment' in currentRecord
        ? currentRecord
        : judgment;
    const status: GrowthJudgment['aiAnalysisStatus'] =
      analysis.provider === 'glm' ? 'completed' : 'fallback';
    const updated: GrowthJudgment = {
      ...currentJudgment,
      aiAnalysisStatus: status,
      aiAnalysis: analysis,
    };
    this.database.saveDecisionRecord(updated);
    this.database.appendActivity({
      caseId: judgment.id,
      action:
        analysis.provider === 'glm'
          ? 'ai_analysis_completed'
          : 'skill_analysis_completed',
      actor:
        analysis.provider === 'glm'
          ? `GLM · ${analysis.model}`
          : analysis.model,
      detail: analysis.summary,
      metadata: {
        source: analysis.provider,
        judgment: analysis.judgment,
        confidence: String(analysis.confidence),
      },
    });
    return updated;
  }

  private saveSkillFallback(
    judgment: GrowthJudgment,
    product: GrowthProduct,
    reason: string,
  ): GrowthJudgment {
    const target: string =
      judgment.adsetName ||
      judgment.adsetId ||
      judgment.campaignName ||
      judgment.campaignId ||
      '产品级';
    const analysis: GrowthAiAnalysis = {
      provider: 'product_skill',
      model: `${product.name} Skill · ${product.skillVersion}`,
      judgment: 'confirmed',
      summary:
        `产品 Skill 判定 ${target} 的 ${judgment.targetMetric.toUpperCase()} ` +
        '已越过人工指标边界，异常条件成立；具体原因仍需人工确认。',
      primaryCause: '当前值越过指标库中的产品正常边界',
      evidence: [judgment.evidence],
      alternativeCauses: [
        '数据延迟或归因未完整',
        '买量竞价、素材效率或产品转化链路变化',
      ],
      recommendedNextStep:
        '先核对同期数据完整性，再按 Campaign 和广告组拆解异常指标。',
      risk: '仅根据阈值能确认异常现象，不能单独证明根因。',
      confidence: Math.min(95, Math.max(0, judgment.confidence)),
      observationHours: Math.max(1, Math.ceil(product.dataDelayMinutes / 60)),
      fallbackReason: reason,
      generatedAt: new Date().toISOString(),
    };
    return this.saveAnalysis(judgment, analysis);
  }

  private saveAnalysisStatus(
    judgment: GrowthJudgment,
    status: GrowthJudgment['aiAnalysisStatus'],
  ): void {
    this.database.saveDecisionRecord({ ...judgment, aiAnalysisStatus: status });
  }

  private saveAnalysisFailure(judgment: GrowthJudgment, message: string): void {
    const currentRecord: DecisionRecord | undefined =
      this.database.getDecisionRecord(judgment.id);
    const currentJudgment: GrowthJudgment =
      currentRecord && 'preliminaryJudgment' in currentRecord
        ? currentRecord
        : judgment;
    this.database.saveDecisionRecord({
      ...currentJudgment,
      aiAnalysisStatus: 'failed',
    });
    this.database.appendActivity({
      caseId: judgment.id,
      action: 'ai_analysis_failed',
      actor: `GLM · ${this.model()}`,
      detail: message,
      metadata: { source: 'glm', mode: 'manual_refresh' },
    });
  }

  private friendlyGlmError(message: string): string {
    if (message.includes('429')) {
      return 'GLM 当前访问量过大，原分析已保留，请稍后手动重试';
    }
    if (message.toLowerCase().includes('timeout')) {
      return 'GLM 分析超时，原分析已保留，请稍后手动重试';
    }
    return `GLM 分析失败，原分析已保留：${message}`;
  }

  private analysisContext(
    product: GrowthProduct,
    judgment: GrowthJudgment,
  ): Record<string, unknown> {
    return {
      product: {
        name: product.name,
        channel: product.channel,
        skillVersion: product.skillVersion,
        dataDelayMinutes: product.dataDelayMinutes,
      },
      entity: {
        campaign: judgment.campaignName || judgment.campaignId || '产品级',
        adset: judgment.adsetName || judgment.adsetId || '未定位',
      },
      anomaly: {
        type: judgment.anomalyType,
        targetMetric: judgment.targetMetric,
        currentValue: judgment.currentValue,
        baselineValue: judgment.baselineValue,
        deviationPct: judgment.deviationPct,
        spend: judgment.spend,
        metricValues: judgment.metricValues,
        evidence: judgment.evidence,
        preliminaryJudgment: judgment.preliminaryJudgment,
      },
      metricStandards: product.metrics.map(
        (metric: GrowthMetricDefinition): Record<string, unknown> => ({
          key: metric.key,
          standardValue: metric.standardValue,
          lowerBound: metric.lowerBound,
          upperBound: metric.upperBound,
          availability: metric.availability,
        }),
      ),
    };
  }

  private systemPrompt(): string {
    return [
      '你是移动应用 Facebook 广告增长分析师。',
      '只根据输入的 Doris 聚合指标和产品 Skill 标准做判断，不补造数据。',
      '区分事实证据、推断和待验证原因；数据不足时必须输出 uncertain。',
      '判断阶段只给诊断下一步，不给预算增减量指令。',
      '输出简体中文且只输出 JSON 对象。',
      '必须包含 judgment, summary, primaryCause, evidence, ' +
        'alternativeCauses, recommendedNextStep, risk, confidence, ' +
        'observationHours。',
      'judgment 只能是 confirmed, uncertain, rejected；confidence 为 0-100；' +
        'observationHours 为 1-168 的整数。',
    ].join('\n');
  }

  private parseJson(content: string): unknown {
    try {
      return JSON.parse(content);
    } catch {
      const start: number = content.indexOf('{');
      const end: number = content.lastIndexOf('}');
      if (start < 0 || end <= start) throw new Error('GLM 未返回 JSON');
      return JSON.parse(content.slice(start, end + 1));
    }
  }

  private isAnalysisPayload(value: unknown): value is GlmAnalysisPayload {
    if (typeof value !== 'object' || value === null) return false;
    const judgment: unknown = Reflect.get(value, 'judgment');
    const evidence: unknown = Reflect.get(value, 'evidence');
    const alternatives: unknown = Reflect.get(value, 'alternativeCauses');
    const confidence: unknown = Reflect.get(value, 'confidence');
    const hours: unknown = Reflect.get(value, 'observationHours');
    const textFields: string[] = [
      'summary',
      'primaryCause',
      'recommendedNextStep',
      'risk',
    ];
    return (
      ['confirmed', 'uncertain', 'rejected'].includes(String(judgment)) &&
      textFields.every(
        (field: string): boolean =>
          typeof Reflect.get(value, field) === 'string',
      ) &&
      Array.isArray(evidence) &&
      evidence.every((item: unknown): boolean => typeof item === 'string') &&
      Array.isArray(alternatives) &&
      alternatives.every(
        (item: unknown): boolean => typeof item === 'string',
      ) &&
      typeof confidence === 'number' &&
      Number.isFinite(confidence) &&
      confidence >= 0 &&
      confidence <= 100 &&
      typeof hours === 'number' &&
      Number.isInteger(hours) &&
      hours >= 1 &&
      hours <= 168
    );
  }

  private model(): string {
    return process.env.GLM_MODEL || GLM_DEFAULT_MODEL;
  }

  private apiKey(): string {
    if (process.env.GLM_API_KEY) return process.env.GLM_API_KEY;
    try {
      return execFileSync(
        'security',
        [
          'find-generic-password',
          '-a',
          process.env.USER || '',
          '-s',
          GLM_KEYCHAIN_SERVICE,
          '-w',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    } catch {
      return '';
    }
  }
}
