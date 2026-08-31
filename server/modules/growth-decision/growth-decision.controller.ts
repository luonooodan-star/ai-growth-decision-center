import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import type {
  CreateProductRequest,
  CreateRecommendationFromJudgmentRequest,
  GrowthDashboardResponse,
  GrowthFetchHistoryResponse,
  GrowthFetchRun,
  GrowthDecisionCase,
  GrowthJudgment,
  GrowthProduct,
  IngestDecisionCaseRequest,
  IngestJudgmentRequest,
  ReviewJudgmentRequest,
  TriggerGrowthFetchRequest,
  UpdateDecisionRequest,
  UpdateMetricStandardsRequest,
  UpdateResultRequest,
} from '@shared/api.interface';

import { GrowthDecisionService } from './growth-decision.service';
import { GrowthDataFetchService } from './growth-data-fetch.service';

@Controller('api/growth-decision')
export class GrowthDecisionController {
  constructor(
    private readonly growthDecisionService: GrowthDecisionService,
    private readonly growthDataFetchService: GrowthDataFetchService,
  ) {}

  @Get('dashboard')
  async getDashboard(): Promise<GrowthDashboardResponse> {
    return this.growthDecisionService.getDashboard();
  }

  @Get('fetch-history')
  getFetchHistory(): GrowthFetchHistoryResponse {
    return this.growthDataFetchService.getHistory();
  }

  @Get('products/:productId/fetch-history')
  getProductFetchHistory(
    @Param('productId') productId: string,
  ): GrowthFetchHistoryResponse {
    return this.growthDataFetchService.getHistory(productId);
  }

  @Post('fetches/trigger')
  async triggerFetch(
    @Body() request: TriggerGrowthFetchRequest,
  ): Promise<GrowthFetchRun[]> {
    return this.growthDataFetchService.trigger('manual', request.productId);
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
