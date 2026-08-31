import { Module } from '@nestjs/common';

import { LocalDatabaseService } from '@server/database/local-database.service';

import { GrowthDecisionController } from './growth-decision.controller';
import { GrowthDataFetchService } from './growth-data-fetch.service';
import { GrowthDecisionOpenApiController } from './growth-decision.openapi.controller';
import { GrowthDecisionService } from './growth-decision.service';

@Module({
  controllers: [GrowthDecisionController, GrowthDecisionOpenApiController],
  providers: [LocalDatabaseService, GrowthDecisionService, GrowthDataFetchService],
  exports: [GrowthDecisionService],
})
export class GrowthDecisionModule {}
