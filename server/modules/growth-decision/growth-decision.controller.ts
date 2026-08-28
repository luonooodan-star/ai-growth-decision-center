import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CreateProductRequest,
  CreateRecommendationFromJudgmentRequest,
  GrowthDashboardResponse,
  GrowthDecisionCase,
  GrowthJudgment,
  GrowthProduct,
  IngestDecisionCaseRequest,
  IngestJudgmentRequest,
  ReviewJudgmentRequest,
  UpdateDecisionRequest,
  UpdateResultRequest,
} from '@shared/api.interface';

import { GrowthDecisionService } from './growth-decision.service';

@Controller('api/growth-decision')
export class GrowthDecisionController {
  constructor(private readonly growthDecisionService: GrowthDecisionService) {}

  @NeedLogin()
  @Get('dashboard')
  async getDashboard(): Promise<GrowthDashboardResponse> {
    return this.growthDecisionService.getDashboard();
  }

  @NeedLogin()
  @Post('products')
  async createProduct(
    @Req() req: Request,
    @Body() request: CreateProductRequest,
  ): Promise<GrowthProduct> {
    return this.growthDecisionService.createProduct(
      request,
      req.userContext.userId,
    );
  }

  @NeedLogin()
  @Post('judgments/ingest')
  async ingestJudgment(
    @Req() req: Request,
    @Body() request: IngestJudgmentRequest,
  ): Promise<GrowthJudgment> {
    return this.growthDecisionService.ingestJudgment(
      request,
      req.userContext.userId,
    );
  }

  @NeedLogin()
  @Patch('judgments/:id/review')
  async reviewJudgment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() request: ReviewJudgmentRequest,
  ): Promise<GrowthJudgment> {
    const actor: string = req.userContext.userName || req.userContext.userId;
    return this.growthDecisionService.reviewJudgment(id, request, actor);
  }

  @NeedLogin()
  @Post('judgments/:id/recommendations')
  async createRecommendationFromJudgment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() request: CreateRecommendationFromJudgmentRequest,
  ): Promise<GrowthDecisionCase> {
    return this.growthDecisionService.createRecommendationFromJudgment(
      id,
      request,
      req.userContext.userId,
    );
  }

  @NeedLogin()
  @Post('cases/ingest')
  async ingestCase(
    @Req() req: Request,
    @Body() request: IngestDecisionCaseRequest,
  ): Promise<GrowthDecisionCase> {
    return this.growthDecisionService.ingestCase(
      request,
      req.userContext.userId,
    );
  }

  @NeedLogin()
  @Patch('cases/:id/decision')
  async updateDecision(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() request: UpdateDecisionRequest,
  ): Promise<GrowthDecisionCase> {
    const actor: string = req.userContext.userName || req.userContext.userId;
    return this.growthDecisionService.updateDecision(id, request, actor);
  }

  @NeedLogin()
  @Patch('cases/:id/result')
  async updateResult(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() request: UpdateResultRequest,
  ): Promise<GrowthDecisionCase> {
    const actor: string = req.userContext.userName || req.userContext.userId;
    return this.growthDecisionService.updateResult(id, request, actor);
  }
}
