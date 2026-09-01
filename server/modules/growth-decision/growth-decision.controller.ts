import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import type {
  AnalyzeJudgmentRequest,
  CreateProductRequest,
  CreateRecommendationFromJudgmentRequest,
  GrowthAiProviderStatus,
  GrowthDataHistoryResponse,
  GrowthDashboardResponse,
  GrowthFetchHistoryResponse,
  GrowthFetchRun,
  GrowthDecisionCase,
  GrowthDecisionHistoryResponse,
  GrowthJudgment,
  GrowthHistoryResetResult,
  GrowthMavisJobListResponse,
  GrowthProduct,
  IngestDecisionCaseRequest,
  IngestJudgmentRequest,
  ReviewJudgmentRequest,
  ResetGrowthHistoryRequest,
  TriggerGrowthFetchRequest,
  UpdateDecisionRequest,
  UpdateMetricStandardsRequest,
  UpdateResultRequest,
} from '@shared/api.interface';

import { GrowthDecisionService } from './growth-decision.service';
import { GrowthDataFetchService } from './growth-data-fetch.service';
import { GrowthMavisAnalysisService } from './growth-mavis-analysis.service';

@Controller('api/growth-decision')
export class GrowthDecisionController {
  constructor(
    private readonly growthDecisionService: GrowthDecisionService,
    private readonly growthDataFetchService: GrowthDataFetchService,
    private readonly growthMavisAnalysisService: GrowthMavisAnalysisService,
  ) {}

  @Get('dashboard')
  async getDashboard(): Promise<GrowthDashboardResponse> {
    return this.growthDecisionService.getDashboard();
  }

  @Get('fetch-history')
  getFetchHistory(): GrowthFetchHistoryResponse {
    return this.growthDataFetchService.getHistory();
  }

  @Get('mavis/status')
  getAiStatus(): GrowthAiProviderStatus {
    return this.growthMavisAnalysisService.getStatus();
  }

  @Get('judgments/:id/mavis-jobs')
  getMavisJobs(
    @Param('id') id: string,
  ): GrowthMavisJobListResponse {
    return this.growthMavisAnalysisService.listJobs(id);
  }

  @Get('records/:id/history')
  async getDecisionHistory(
    @Param('id') id: string,
  ): Promise<GrowthDecisionHistoryResponse> {
    return this.growthDecisionService.getDecisionHistory(id);
  }

  @Get('products/:productId/fetch-history')
  getProductFetchHistory(
    @Param('productId') productId: string,
  ): GrowthFetchHistoryResponse {
    return this.growthDataFetchService.getHistory(productId);
  }

  @Get('products/:productId/data-history')
  getProductDataHistory(
    @Param('productId') productId: string,
  ): GrowthDataHistoryResponse {
    return { items: this.growthDataFetchService.getDataHistory(productId) };
  }

  @Post('fetches/trigger')
  async triggerFetch(
    @Body() request: TriggerGrowthFetchRequest,
  ): Promise<GrowthFetchRun[]> {
    return this.growthDataFetchService.trigger(
      'manual',
      request.productId,
      request.historyDays,
    );
  }

  @Post('history/reset')
  resetHistory(
    @Body() request: ResetGrowthHistoryRequest,
  ): GrowthHistoryResetResult {
    if (request.confirmation !== 'RESET_HISTORY') {
      throw new BadRequestException('清空确认信息不正确');
    }
    return this.growthDecisionService.resetHistory();
  }

  @Post('products')
  async createProduct(
    @Body() request: CreateProductRequest,
  ): Promise<GrowthProduct> {
    return this.growthDecisionService.createProduct(request, 'local_operator');
  }

  @Patch('products/:productId/metric-standards')
  async updateMetricStandards(
    @Param('productId') productId: string,
    @Body() request: UpdateMetricStandardsRequest,
  ): Promise<GrowthProduct> {
    return this.growthDecisionService.updateMetricStandards(
      productId,
      request,
      '人工决策负责人',
    );
  }

  @Post('judgments/ingest')
  async ingestJudgment(
    @Body() request: IngestJudgmentRequest,
  ): Promise<GrowthJudgment> {
    return this.growthDecisionService.ingestJudgment(
      request,
      'local_doris_worker',
    );
  }

  @Patch('judgments/:id/review')
  async reviewJudgment(
    @Param('id') id: string,
    @Body() request: ReviewJudgmentRequest,
  ): Promise<GrowthJudgment> {
    return this.growthDecisionService.reviewJudgment(
      id,
      request,
      '人工决策负责人',
    );
  }

  @Post('judgments/:id/mavis-analysis')
  async analyzeJudgment(
    @Param('id') id: string,
    @Body() request?: AnalyzeJudgmentRequest,
  ): Promise<GrowthJudgment> {
    return this.growthMavisAnalysisService.analyzeJudgment(
      id,
      request?.mode || 'default',
      'manual',
    );
  }

  @Post('judgments/:id/recommendations')
  async createRecommendationFromJudgment(
    @Param('id') id: string,
    @Body() request: CreateRecommendationFromJudgmentRequest,
  ): Promise<GrowthDecisionCase> {
    return this.growthDecisionService.createRecommendationFromJudgment(
      id,
      request,
      'local_operator',
    );
  }

  @Post('judgments/:id/generate-recommendation')
  async generateRecommendationFromSkill(
    @Param('id') id: string,
  ): Promise<GrowthDecisionCase> {
    return this.growthDecisionService.generateRecommendationFromSkill(
      id,
      '产品 Skill',
    );
  }

  @Post('cases/ingest')
  async ingestCase(
    @Body() request: IngestDecisionCaseRequest,
  ): Promise<GrowthDecisionCase> {
    return this.growthDecisionService.ingestCase(request, 'local_doris_worker');
  }

  @Patch('cases/:id/decision')
  async updateDecision(
    @Param('id') id: string,
    @Body() request: UpdateDecisionRequest,
  ): Promise<GrowthDecisionCase> {
    return this.growthDecisionService.updateDecision(
      id,
      request,
      '人工决策负责人',
    );
  }

  @Patch('cases/:id/result')
  async updateResult(
    @Param('id') id: string,
    @Body() request: UpdateResultRequest,
  ): Promise<GrowthDecisionCase> {
    return this.growthDecisionService.updateResult(
      id,
      request,
      '人工决策负责人',
    );
  }
}
