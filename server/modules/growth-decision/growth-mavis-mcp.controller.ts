import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';

import type {
  CompleteGrowthMavisJobRequest,
  GrowthMavisJob,
} from '@shared/api.interface';

import { GrowthMavisAnalysisService } from './growth-mavis-analysis.service';

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
    name: 'claim_analysis_job',
    description: '领取一个等待 Marvis 分析的广告异常任务',
    inputSchema: {
      type: 'object',
      properties: { workerId: { type: 'string' } },
      required: ['workerId'],
    },
  },
  {
    name: 'get_anomaly_context',
    description: '读取异常、产品指标标准和 Skill 版本上下文',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  },
  {
    name: 'submit_anomaly_analysis',
    description: '回写结构化异常判断、证据、原因和下一步诊断建议',
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
    description: '记录 Marvis 分析任务失败和错误原因',
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
    if (name === 'fail_analysis_job') {
      return this.growthMavisAnalysisService.failJob(
        this.stringArg(args, 'jobId'),
        {
          workerId: this.stringArg(args, 'workerId'),
          error: this.stringArg(args, 'error'),
        },
      );
    }
    throw new BadRequestException(`未知 Marvis Tool：${name}`);
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

  private success(id: string | number | undefined, result: unknown): MavisMcpResponse {
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
