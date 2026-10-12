import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { CreativeAnalysisQuery } from '@shared/creative-analysis.interface';
import { CreativeAnalysisService } from './creative-analysis.service';
import { MellowSharingService } from './mellow-sharing.service';
import { centerIdentity } from '../../common/utils/center-identity';
import {
  isMellowRecipient,
  canReadMellowShared,
} from '../../common/utils/mellow-sharing';

@Controller('api/growth-decision/analysis')
export class CreativeAnalysisController {
  constructor(
    private readonly service: CreativeAnalysisService,
    private readonly shared: MellowSharingService,
  ) {}
  @Get('sharing') sharing() {
    return {
      enabled: canReadMellowShared(centerIdentity.getStore()),
      recipient: isMellowRecipient(centerIdentity.getStore()),
    };
  }
  @Post('mellow-roas') roas(@Body() query: CreativeAnalysisQuery) {
    return this.shared.roas(query);
  }
  @Post('query') start(@Body() query: CreativeAnalysisQuery) {
    if (isMellowRecipient(centerIdentity.getStore()))
      return this.shared.start(query);
    return this.service.start(query);
  }
  @Get('query/:id') status(@Param('id') id: string) {
    if (isMellowRecipient(centerIdentity.getStore()))
      return this.shared.status(id);
    return this.service.status(id);
  }
  @Delete('query/:id') cancel(@Param('id') id: string) {
    if (isMellowRecipient(centerIdentity.getStore()))
      return this.shared.cancel(id);
    return this.service.cancel(id);
  }
}
