import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { LocalDatabaseService } from '@server/database/local-database.service';

import { GrowthDecisionController } from './growth-decision.controller';
import { GrowthDataFetchService } from './growth-data-fetch.service';
import { GrowthDecisionOpenApiController } from './growth-decision.openapi.controller';
import { GrowthDecisionService } from './growth-decision.service';
import { GrowthAiAnalysisService } from './growth-ai-analysis.service';

@Module({
  imports: [HttpModule],
  controllers: [GrowthDecisionController, GrowthDecisionOpenApiController],
  providers: [
    LocalDatabaseService,
    GrowthDecisionService,
    GrowthDataFetchService,
    GrowthAiAnalysisService,
  ],
  exports: [GrowthDecisionService],
})
export class GrowthDecisionModule {}
