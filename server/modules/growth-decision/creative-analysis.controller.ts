import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { CreativeAnalysisQuery } from '@shared/creative-analysis.interface';
import { CreativeAnalysisService } from './creative-analysis.service';

@Controller('api/growth-decision/analysis')
export class CreativeAnalysisController {
  constructor(private readonly service: CreativeAnalysisService) {}
  @Post('query') start(@Body() query: CreativeAnalysisQuery) {
    return this.service.start(query);
  }
  @Get('query/:id') status(@Param('id') id: string) {
    return this.service.status(id);
  }
  @Delete('query/:id') cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }
}
