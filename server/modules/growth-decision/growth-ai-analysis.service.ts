import { HttpService } from '@nestjs/axios';
import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import { execFileSync } from 'node:child_process';

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

interface GroqAnalysisPayload {
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

interface GroqChatResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

const GROQ_DEFAULT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';
const GROQ_KEYCHAIN_SERVICE = 'ai-growth-decision-center-groq';

const ANALYSIS_SCHEMA = {
  name: 'growth_anomaly_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      judgment: { type: 'string', enum: ['confirmed', 'uncertain', 'rejected'] },
      summary: { type: 'string' },
      primaryCause: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' } },
      alternativeCauses: { type: 'array', items: { type: 'string' } },
      recommendedNextStep: { type: 'string' },
      risk: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
      observationHours: { type: 'integer', minimum: 1, maximum: 168 },
    },
    required: [
      'judgment',
      'summary',
      'primaryCause',
      'evidence',
      'alternativeCauses',
      'recommendedNextStep',
      'risk',
      'confidence',
      'observationHours',
    ],
  },
};

@Injectable()
export class GrowthAiAnalysisService {
  private readonly logger: Logger = new Logger(GrowthAiAnalysisService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly database: LocalDatabaseService,
  ) {}

  getStatus(): GrowthAiProviderStatus {
    return {
      provider: 'groq',
      model: this.model(),
      configured: Boolean(this.apiKey()),
    };
  }

  async analyzeJudgment(id: string): Promise<GrowthJudgment> {
    const record: DecisionRecord | undefined =
      this.database.getDecisionRecord(id);
    if (!record || !('preliminaryJudgment' in record)) {
      throw new NotFoundException('异常判断不存在');
    }
    const product: GrowthProduct | undefined =
      this.database.getProduct(record.productId);
    if (!product) throw new NotFoundException('产品不存在');
    const apiKey: string = this.apiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Groq API Key 未配置，请在公司 Mac 运行 configure-groq.sh',
      );
    }

    const model: string = this.model();
    const payload: GroqAnalysisPayload = await this.requestAnalysis(
      apiKey,
      model,
      product,
      record,
    );
    const analysis: GrowthAiAnalysis = {
      provider: 'groq',
      model,
      ...payload,
      confidence: Math.round(payload.confidence),
      observationHours: Math.round(payload.observationHours),
      generatedAt: new Date().toISOString(),
    };
    const updated: GrowthJudgment = { ...record, aiAnalysis: analysis };
    this.database.saveDecisionRecord(updated);
    this.database.appendActivity({
      caseId: record.id,
      action: 'ai_analysis_completed',
      actor: `Groq · ${model}`,
      detail: analysis.summary,
      metadata: {
        source: 'groq_api',
        judgment: analysis.judgment,
        confidence: String(analysis.confidence),
      },
    });
    return updated;
  }

  private async requestAnalysis(
    apiKey: string,
    model: string,
    product: GrowthProduct,
    judgment: GrowthJudgment,
  ): Promise<GroqAnalysisPayload> {
    try {
      const response = await lastValueFrom(
        this.httpService.post<GroqChatResponse>(
          process.env.GROQ_API_URL || GROQ_DEFAULT_URL,
          {
            model,
            reasoning_effort: 'high',
            messages: [
              {
                role: 'system',
                content: this.systemPrompt(),
              },
              {
                role: 'user',
                content: JSON.stringify(
                  this.analysisContext(product, judgment),
                ),
              },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: ANALYSIS_SCHEMA,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(90_000),
          },
        ),
      );
      const content: string | undefined =
        response.data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Groq 未返回分析内容');
      const parsed: unknown = JSON.parse(content);
      if (!this.isAnalysisPayload(parsed)) {
        throw new Error('Groq 返回结果不符合分析结构');
      }
      return parsed;
    } catch (error: unknown) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Groq 深度分析失败：${message}`, error instanceof Error ? error.stack : undefined);
      throw new BadGatewayException(`Groq 深度分析失败：${message}`);
    }
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
      '只根据输入的聚合指标和产品指标标准做判断，不补造数据。',
      '区分事实证据、推断和待验证原因；数据不足时必须输出 uncertain。',
      '建议优先是诊断或小范围验证，不自动执行预算调整。',
      '输出简体中文，并严格符合提供的 JSON Schema。',
    ].join('\n');
  }

  private isAnalysisPayload(value: unknown): value is GroqAnalysisPayload {
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
      textFields.every((field: string): boolean =>
        typeof Reflect.get(value, field) === 'string',
      ) &&
      Array.isArray(evidence) &&
      evidence.every((item: unknown): boolean => typeof item === 'string') &&
      Array.isArray(alternatives) &&
      alternatives.every((item: unknown): boolean => typeof item === 'string') &&
      typeof confidence === 'number' &&
      Number.isFinite(confidence) &&
      typeof hours === 'number' &&
      Number.isFinite(hours)
    );
  }

  private model(): string {
    return process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL;
  }

  private apiKey(): string {
    if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
    try {
      return execFileSync(
        'security',
        [
          'find-generic-password',
          '-a',
          process.env.USER || '',
          '-s',
          GROQ_KEYCHAIN_SERVICE,
          '-w',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    } catch {
      return '';
    }
  }
}
