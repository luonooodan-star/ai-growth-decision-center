import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { GrowthDecisionModule } from './modules/growth-decision/growth-decision.module';
import { ViewModule } from './modules/view/view.module';

@Module({
  imports: [GrowthDecisionModule, ViewModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class StandaloneAppModule {}
