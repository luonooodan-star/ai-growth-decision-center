import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';

import type {
  CompleteGrowthMavisBatchJobRequest,
  CompleteGrowthMavisJobRequest,
  GrowthMavisJob,
} from '@shared/api.interface';

import { GrowthMavisAnalysisService } from './growth-mavis-analysis.service';
import { MetaOperationsService } from './meta-operations.service';

interface MavisMcpRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

interface MavisMcpResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

const MAVIS_MCP_TOOLS: Array<Record<string, unknown>> = [
  {
    name: 'import_meta_operations',
    description: '导入只读 Meta 操作日志，按稳定指纹去重，并关联 Doris 系列快照；不执行广告变更。合同见 shared/meta-operations.ts。',
    inputSchema: { type: 'object', properties: { operations: { type: 'array', maxItems: 500, items: { type: 'object' } }, entities: { type: 'array', maxItems: 500, items: { type: 'object' } } }, required: ['operations'] },
  },
  {
    name: 'claim_analysis_job',
    description: '领取一个等待 Codex 分析的整批广告异常任务',
    inputSchema: {
      type: 'object',
      properties: { workerId: { type: 'string' } },
      required: ['workerId'],
    },
  },
  {
    name: 'get_anomaly_context',
    description:
      '读取单条或整批异常、完整交付指标、历史对照、Campaign/广告组/国家拆分、缺失维度、产品标准和 Skill 版本',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  },
  {
    name: 'submit_batch_analysis',
    description:
      '一次回写整批任务中全部异常的结构化分析，服务会按 judgmentId 拆分到各异常记录',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        workerId: { type: 'string' },
        model: { type: 'string' },
        analyses: { type: 'array', items: { type: 'object' } },
      },
      required: ['jobId', 'workerId', 'model', 'analyses'],
    },
  },
  {
    name: 'submit_anomaly_analysis',
    description:
      '回写结构化深度分析、指标链路根因、具体投放动作、观察护栏和回滚条件',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        workerId: { type: 'string' },
        model: { type: 'string' },
        analysis: { type: 'object' },
      },
      required: ['jobId', 'workerId', 'model', 'analysis'],
    },
  },
  {
    name: 'fail_analysis_job',
    description: '记录 Codex 分析任务失败和错误原因',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        workerId: { type: 'string' },
        error: { type: 'string' },
      },
      required: ['jobId', 'workerId', 'error'],
    },
  },
];

@Controller('mcp/growth-decision')
export class GrowthMavisMcpController {
  constructor(
    private readonly growthMavisAnalysisService: GrowthMavisAnalysisService,
    private readonly metaOperations: MetaOperationsService,
  ) {}

  @Post()
  handleMcp(
    @Headers('x-mavis-token') mavisToken: string | undefined,
    @Headers('x-marvis-token') marvisToken: string | undefined,
    @Body() request: MavisMcpRequest,
  ): MavisMcpResponse {
    this.growthMavisAnalysisService.authorize(marvisToken || mavisToken);
    if (request.jsonrpc !== '2.0') {
      return this.error(request.id, -32600, '仅支持 JSON-RPC 2.0');
    }
    try {
      if (request.method === 'initialize') {
        return this.success(request.id, {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: 'ai-growth-decision-center',
            version: '1.0.0',
          },
        });
      }
      if (request.method === 'notifications/initialized') {
        return this.success(request.id, {});
      }
      if (request.method === 'tools/list') {
        return this.success(request.id, { tools: MAVIS_MCP_TOOLS });
      }
      if (request.method === 'tools/call') {
        const data: unknown = this.callTool(
          request.params?.name || '',
          request.params?.arguments || {},
        );
        return this.success(request.id, {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          structuredContent: data,
        });
      }
      return this.error(request.id, -32601, '不支持的 MCP 方法');
    } catch (error: unknown) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      return this.error(request.id, -32000, message);
    }
  }

  private callTool(name: string, args: Record<string, unknown>): unknown {
    if (name === 'import_meta_operations') return this.metaOperations.import(args);
    if (name === 'claim_analysis_job') {
      const job: GrowthMavisJob | undefined =
        this.growthMavisAnalysisService.claimNextJob(
          this.stringArg(args, 'workerId'),
        );
      return { job: job || null };
    }
    if (name === 'get_anomaly_context') {
      return this.growthMavisAnalysisService.getJobContext(
        this.stringArg(args, 'jobId'),
      );
    }
    if (name === 'submit_anomaly_analysis') {
      const analysis: unknown = args.analysis;
      if (!this.isAnalysis(analysis)) {
        throw new BadRequestException('analysis 不符合结构化输出合同');
      }
      return this.growthMavisAnalysisService.completeJob(
        this.stringArg(args, 'jobId'),
        {
          workerId: this.stringArg(args, 'workerId'),
          model: this.stringArg(args, 'model'),
          analysis,
        },
      );
    }
    if (name === 'submit_batch_analysis') {
      const analyses: unknown = args.analyses;
      if (
        !Array.isArray(analyses) ||
        analyses.some(
          (item: unknown): boolean =>
            typeof item !== 'object' ||
            item === null ||
            typeof Reflect.get(item, 'judgmentId') !== 'string' ||
            !this.isAnalysis(Reflect.get(item, 'analysis')),
        )
      ) {
        throw new BadRequestException('analyses 不符合整批结构化输出合同');
      }
      return this.growthMavisAnalysisService.completeBatchJob(
        this.stringArg(args, 'jobId'),
        {
          workerId: this.stringArg(args, 'workerId'),
          model: this.stringArg(args, 'model'),
          analyses,
        } as CompleteGrowthMavisBatchJobRequest,
      );
    }
    if (name === 'fail_analysis_job') {
      return this.growthMavisAnalysisService.failJob(
        this.stringArg(args, 'jobId'),
        {
          workerId: this.stringArg(args, 'workerId'),
          error: this.stringArg(args, 'error'),
        },
      );
    }
    throw new BadRequestException(`未知 Codex Tool：${name}`);
  }

  private stringArg(args: Record<string, unknown>, key: string): string {
    const value: unknown = args[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${key} 不能为空`);
    }
    return value.trim();
  }

  private isAnalysis(
    value: unknown,
  ): value is CompleteGrowthMavisJobRequest['analysis'] {
    if (typeof value !== 'object' || value === null) return false;
    const judgment: unknown = Reflect.get(value, 'judgment');
    const textFields: string[] = [
      'summary',
      'primaryCause',
      'recommendedNextStep',
      'risk',
    ];
    const evidence: unknown = Reflect.get(value, 'evidence');
    const alternatives: unknown = Reflect.get(value, 'alternativeCauses');
    const confidence: unknown = Reflect.get(value, 'confidence');
    const observationHours: unknown = Reflect.get(value, 'observationHours');
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
      typeof observationHours === 'number'
    );
  }

  private success(
    id: string | number | undefined,
    result: unknown,
  ): MavisMcpResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private error(
    id: string | number | undefined,
    code: number,
    message: string,
  ): MavisMcpResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}
