import { Controller, Get, Post, Query } from '@nestjs/common';
import type { BiQuery } from '@shared/paid-growth.interface';
import { PaidGrowthService } from './paid-growth.service';

@Controller('api/growth-decision/bi')
export class PaidGrowthController {
  constructor(private readonly service: PaidGrowthService) {}
  @Get('day') day(@Query() query: BiQuery) {
    return this.service.day(query);
  }
  @Get('products') products() {
    return this.service.products();
  }
  @Post('products/sync') sync() {
    return this.service.syncProducts();
  }
}
