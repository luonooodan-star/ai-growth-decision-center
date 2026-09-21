import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  MetaAdjustmentChange,
  MetaAdjustmentTarget,
} from '@shared/api.interface';
import { MetaAdjustmentService } from './meta-adjustment.service';

// Standalone Basic Auth protects every route; mutations additionally require same-origin JSON.
@Controller('api/growth-decision/adjustments')
export class MetaAdjustmentController {
  constructor(private readonly service: MetaAdjustmentService) {}
  private write(req: Request): string {
    if (
      !req.headers.origin ||
      new URL(req.headers.origin).host !== req.headers.host ||
      !req.is('application/json')
    )
      throw new BadRequestException('仅允许本站确认提交');
    return req.headers.cookie || '';
  }
  @Post('inspect') inspect(
    @Req() req: Request,
    @Body() body: { target: MetaAdjustmentTarget; creative?: boolean },
  ) {
    return this.service.inspect(
      this.write(req),
      body.target,
      body.creative === true,
    );
  }
  @Post('preview') preview(
    @Req() req: Request,
    @Body() body: { changes: MetaAdjustmentChange[] },
  ) {
    return this.service.preview(this.write(req), body.changes);
  }
  @Post(':id/submit') submit(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { confirmed: boolean },
  ) {
    if (body.confirmed !== true) throw new BadRequestException('需要明确确认');
    return this.service.submit(this.write(req), id);
  }
  @Get() list(@Req() req: Request) {
    return this.service.list(req.headers.cookie || '');
  }
}
