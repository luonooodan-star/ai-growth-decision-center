import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import type {
  CampaignDecisionPolicy,
  CampaignRulesConfig,
  CampaignBatchAnalysisRequest,
  DecideCampaignRequest,
  ExecuteCampaignRequest,
} from '@shared/api.interface';
import { CampaignDecisionService } from './campaign-decision.service';
import { CampaignBoardManagementService } from './campaign-board-management.service';
import { OptimizerWorkflowService } from './optimizer-workflow.service';
import { OptimizerWeeklyService } from './optimizer-weekly.service';

// 沿用 standalone.ts 的 growth 身份认证，与现有决策 API 一致。
@Controller('api/growth-decision')
export class CampaignDecisionController {
  constructor(
    private readonly service: CampaignDecisionService,
    private readonly management: CampaignBoardManagementService,
    private readonly workflow: OptimizerWorkflowService,
    private readonly weekly: OptimizerWeeklyService,
  ) {}

  @Get('products/:productId/weekly-review')
  weeklyState(@Param('productId') id: string) {
    return this.weekly.state(id);
  }
  @Put('products/:productId/weekly-review')
  weeklyConfig(
    @Param('productId') id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.weekly.configure(id, body?.enabled);
  }
  @Post('products/:productId/weekly-review')
  weeklyGenerate(@Param('productId') id: string) {
    return this.weekly.generate(id);
  }

  @Get('products/:productId/optimizer-review')
  review(@Param('productId') id: string) {
    return this.workflow.review(id);
  }

  @Post('campaign-orders/:id/observation-review')
  observation(
    @Param('id') id: string,
    @Body()
    body: { action: 'finish' | 'extend'; reason: string; confirmation: string },
  ) {
    return this.workflow.observe(id, body);
  }

  @Post('campaign-orders/:id/knowledge')
  knowledge(
    @Param('id') id: string,
    @Body() body: { confirmation: string; conclusion: string },
  ) {
    return this.workflow.publishKnowledge(id, body);
  }

  @Get('products/:productId/campaign-rules')
  rules(@Param('productId') productId: string) {
    return this.management.rules(productId);
  }

  @Put('products/:productId/campaign-rules')
  saveRules(
    @Param('productId') productId: string,
    @Body() body: CampaignRulesConfig,
  ) {
    return this.management.saveRules(productId, body);
  }

  @Post('products/:productId/campaign-rules/preview')
  preview(@Param('productId') id: string, @Body() body: CampaignRulesConfig) {
    return this.management.preview(id, body);
  }

  @Get('products/:productId/campaign-rules/versions')
  versions(@Param('productId') id: string) {
    return this.management.versions(id);
  }

  @Post('products/:productId/campaign-analysis-batch')
  analyzeBatch(
    @Param('productId') productId: string,
    @Body() body: CampaignBatchAnalysisRequest,
  ) {
    return this.management.analyzeBatch(productId, body);
  }

  @Get('products/:productId/campaign-board')
  board(@Param('productId') productId: string) {
    return this.service.board(productId);
  }

  @Post('products/:productId/campaign-viewed')
  viewed(
    @Param('productId') id: string,
    @Body() body: { key: string; revision: string },
  ) {
    return this.management.viewed(id, body);
  }

  @Patch('products/:productId/campaign-policy')
  policy(
    @Param('productId') productId: string,
    @Body() body: CampaignDecisionPolicy,
  ) {
    return this.service.updatePolicy(productId, body);
  }

  @Post('products/:productId/campaign-analysis')
  analyze(
    @Param('productId') productId: string,
    @Body() body: { key: string; revision: string; force?: boolean },
  ) {
    return this.service.analyze(
      productId,
      body?.key,
      body?.revision,
      false,
      body?.force === true,
    );
  }

  @Post('products/:productId/campaign-observations-batch')
  observeBatch(
    @Param('productId') id: string,
    @Body()
    body: CampaignBatchAnalysisRequest & {
      reason: string;
      confirmation: string;
    },
  ) {
    return this.management.observeBatch(id, body);
  }

  @Post('products/:productId/campaign-decisions')
  decide(
    @Param('productId') productId: string,
    @Body() body: DecideCampaignRequest,
  ) {
    return this.service.decide(productId, body);
  }

  @Post('campaign-orders/:id/executed')
  execute(@Param('id') id: string, @Body() body: ExecuteCampaignRequest) {
    return this.service.execute(id, body);
  }
}
