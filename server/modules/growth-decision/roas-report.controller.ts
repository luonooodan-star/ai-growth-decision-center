import { PaidGrowthService } from './paid-growth.service';
import { Body, Controller, Get, Post } from '@nestjs/common';
import type { CreativeAnalysisQuery } from '@shared/creative-analysis.interface';
import { RoasReportService } from './roas-report.service';
@Controller('api/growth-decision/roas-report')
export class RoasReportController {
  constructor(
    private readonly service: RoasReportService,
    private readonly bi: PaidGrowthService,
  ) {}
  @Get('channels') channels() {
    return this.bi.buyerChannelOptions();
  }
  @Post() query(@Body() q: CreativeAnalysisQuery) {
    return this.service.query(q);
  }
}
