import { Controller, Get, Query } from '@nestjs/common';
import { MetaOperationsService } from './meta-operations.service';

// Same standalone growth authentication as other dashboard routes. Import is token-protected MCP only.
@Controller('api/growth-decision/meta-operations')
export class MetaOperationsController {
  constructor(private readonly service: MetaOperationsService) {}
  @Get('entities')
  entities() {
    return this.service.entities();
  }
  @Get()
  list(@Query('page') page?: string) {
    return this.service.overview(Number(page || 1));
  }
}
