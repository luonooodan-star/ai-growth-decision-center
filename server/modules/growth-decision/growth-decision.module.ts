import { Module } from '@nestjs/common';
import { LocalDatabaseService } from '@server/database/local-database.service';

import { GrowthDecisionController } from './growth-decision.controller';
import { GrowthDataFetchService } from './growth-data-fetch.service';
import { GrowthDecisionOpenApiController } from './growth-decision.openapi.controller';
import { GrowthDecisionService } from './growth-decision.service';
import { GrowthMavisAnalysisService } from './growth-mavis-analysis.service';
import { GrowthMavisMcpController } from './growth-mavis-mcp.controller';
import { CampaignDecisionController } from './campaign-decision.controller';
import { CampaignDecisionService } from './campaign-decision.service';
import { CampaignBoardManagementService } from './campaign-board-management.service';
import { OptimizerWorkflowService } from './optimizer-workflow.service';
import { OptimizerWeeklyService } from './optimizer-weekly.service';
import { PaidGrowthController } from './paid-growth.controller';
import { PaidGrowthService } from './paid-growth.service';
import { MetaOperationsService } from './meta-operations.service';
import { MetaOperationsController } from './meta-operations.controller';
import { SkillReviewService } from './skill-review.service';

@Module({
  controllers: [
    MetaOperationsController,
    PaidGrowthController,
    CampaignDecisionController,
    GrowthDecisionController,
    GrowthDecisionOpenApiController,
    GrowthMavisMcpController,
  ],
  providers: [
    SkillReviewService,
    MetaOperationsService,
    PaidGrowthService,
    OptimizerWorkflowService,
    OptimizerWeeklyService,
    CampaignBoardManagementService,
    CampaignDecisionService,
    LocalDatabaseService,
    GrowthDecisionService,
    GrowthDataFetchService,
    GrowthMavisAnalysisService,
  ],
  exports: [GrowthDecisionService],
})
export class GrowthDecisionModule {}
