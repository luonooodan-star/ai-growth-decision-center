import { Controller, Get, Post, Query } from '@nestjs/common';
import type { BiQuery } from '@shared/paid-growth.interface';
import { PaidGrowthService } from './paid-growth.service';
import { LocalDatabaseService } from '@server/database/local-database.service';
import type { MetricStandardProduct } from '@shared/metric-signals';
import type { AdjustmentQuery } from '@shared/api.interface';
import { AdAdjustmentService } from './ad-adjustment.service';

@Controller('api/growth-decision/bi')
export class PaidGrowthController {
  constructor(
    private readonly service: PaidGrowthService,
    private readonly db: LocalDatabaseService,
    private readonly adjustment: AdAdjustmentService,
  ) {}
  @Get('standards') standards(): MetricStandardProduct[] {
    return this.db
      .listProducts()
      .map(({ id, name, channel, dorisAppId, metrics }) => ({
        id,
        name,
        channel,
        dorisAppId,
        metrics,
      }));
  }
  @Get('day') day(@Query() query: BiQuery) {
    return this.service.day(query);
  }
  @Get('channel-spend') channelSpend(
    @Query('date') date: string,
    @Query('appId') appId: string,
  ) {
    return this.service.channelSpend(date, appId);
  }
  @Get('adjustment-day') adjustmentDay(@Query() query: AdjustmentQuery) {
    return this.adjustment.day(query);
  }
  @Get('products') products() {
    return this.service.products();
  }
  @Get('products/options') productOptions() {
    return this.service.productOptions();
  }
  @Post('products/sync') sync() {
    return this.service.syncProducts();
  }
}
