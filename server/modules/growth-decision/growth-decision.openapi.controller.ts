import { Body, Controller, Param, Post } from '@nestjs/common';

import type {
  CreateProductRequest,
  CreateRecommendationFromJudgmentRequest,
  GrowthDecisionCase,
  GrowthJudgment,
  GrowthProduct,
  IngestDecisionCaseRequest,
  IngestJudgmentRequest,
} from '@shared/api.interface';

import { GrowthDecisionService } from './growth-decision.service';

@Controller('openapi/growth-decision')
export class GrowthDecisionOpenApiController {
  constructor(private readonly growthDecisionService: GrowthDecisionService) {}

  @Post('products')
  async createProduct(
    @Body() request: CreateProductRequest,
  ): Promise<GrowthProduct> {
    return this.growthDecisionService.createProduct(
      request,
      'system_integration',
    );
  }

  @Post('cases')
  async ingestCase(
    @Body() request: IngestDecisionCaseRequest,
  ): Promise<GrowthDecisionCase> {
    return this.growthDecisionService.ingestCase(
      request,
      'system_integration',
    );
  }

  @Post('judgments')
  async ingestJudgment(
    @Body() request: IngestJudgmentRequest,
  ): Promise<GrowthJudgment> {
    return this.growthDecisionService.ingestJudgment(
      request,
      'system_integration',
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
      'system_integration',
    );
  }
}
