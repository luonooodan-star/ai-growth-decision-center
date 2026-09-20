import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MetaOperationsService } from './meta-operations.service';
import { SkillReviewService } from './skill-review.service';

// Same standalone growth authentication as other dashboard routes. Import is token-protected MCP only.
@Controller('api/growth-decision/meta-operations')
export class MetaOperationsController {
  constructor(
    private readonly service: MetaOperationsService,
    private readonly skills: SkillReviewService,
  ) {}
  @Get('weekly') weekly() {
    return this.skills.list();
  }
  @Post('weekly') generate() {
    return this.skills.generate();
  }
  @Post('weekly/:id/retry') retry(@Param('id') id: string) {
    return this.skills.retry(id);
  }
  @Post('weekly/:id/review') review(
    @Param('id') id: string,
    @Body() body: { index: number; decision: unknown },
  ) {
    return this.skills.review(id, body.index, body.decision);
  }
  @Post(':id/reason') reason(
    @Param('id') id: string,
    @Body() body: { reason: unknown },
  ) {
    return this.service.annotate(id, body.reason);
  }
  @Get('entities')
  entities() {
    return this.service.entities();
  }
  @Get()
  list(@Query('page') page?: string) {
    return this.service.overview(Number(page || 1));
  }
}
