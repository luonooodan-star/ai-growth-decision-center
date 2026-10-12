import { Module } from '@nestjs/common';
import { CreativeAnalysisController } from './creative-analysis.controller';
import { CreativeAnalysisService } from './creative-analysis.service';
import { MellowSharingService } from './mellow-sharing.service';
import { PersonalDorisController } from './personal-doris.controller';
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
import { AdAdjustmentService } from './ad-adjustment.service';
import { MetaOperationsService } from './meta-operations.service';
import { MetaOperationsController } from './meta-operations.controller';
import { SkillReviewService } from './skill-review.service';
import { MetaWorkspaceController } from './meta-workspace.controller';
import { MetaAdjustmentController } from './meta-adjustment.controller';
import { MetaAdjustmentService } from './meta-adjustment.service';

@Module({
  controllers: [
    CreativeAnalysisController,
    PersonalDorisController,
    MetaAdjustmentController,
    MetaWorkspaceController,
    MetaOperationsController,
    PaidGrowthController,
    CampaignDecisionController,
    GrowthDecisionController,
    GrowthDecisionOpenApiController,
    GrowthMavisMcpController,
  ],
  providers: [
    MellowSharingService,
    CreativeAnalysisService,
    MetaAdjustmentService,
    SkillReviewService,
    MetaOperationsService,
    PaidGrowthService,
    AdAdjustmentService,
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
