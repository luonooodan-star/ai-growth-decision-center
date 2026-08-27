import { Module } from '@nestjs/common';

import { GrowthDecisionController } from './growth-decision.controller';
import { GrowthDecisionAutomation } from './growth-decision.automation';
import { GrowthDecisionOpenApiController } from './growth-decision.openapi.controller';
import { GrowthDecisionService } from './growth-decision.service';

@Module({
  controllers: [GrowthDecisionController, GrowthDecisionOpenApiController],
  providers: [GrowthDecisionService, GrowthDecisionAutomation],
  exports: [GrowthDecisionService],
})
export class GrowthDecisionModule {}
