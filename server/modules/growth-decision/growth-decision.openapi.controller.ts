import { Body, Controller, Post } from '@nestjs/common';

import type {
  CreateProductRequest,
  GrowthDecisionCase,
  GrowthProduct,
  IngestDecisionCaseRequest,
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
}
