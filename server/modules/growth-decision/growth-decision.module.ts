import { Module } from '@nestjs/common';
import { LocalDatabaseService } from '@server/database/local-database.service';

import { GrowthDecisionController } from './growth-decision.controller';
import { GrowthDataFetchService } from './growth-data-fetch.service';
import { GrowthDecisionOpenApiController } from './growth-decision.openapi.controller';
import { GrowthDecisionService } from './growth-decision.service';
import { GrowthMavisAnalysisService } from './growth-mavis-analysis.service';
import { GrowthMavisMcpController } from './growth-mavis-mcp.controller';

@Module({
  controllers: [
    GrowthDecisionController,
    GrowthDecisionOpenApiController,
    GrowthMavisMcpController,
  ],
  providers: [
    LocalDatabaseService,
    GrowthDecisionService,
    GrowthDataFetchService,
    GrowthMavisAnalysisService,
  ],
  exports: [GrowthDecisionService],
})
export class GrowthDecisionModule {}
