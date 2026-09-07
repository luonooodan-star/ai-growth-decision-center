import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type {
  CampaignDecisionPolicy,
  DecideCampaignRequest,
  ExecuteCampaignRequest,
} from '@shared/api.interface';
import { CampaignDecisionService } from './campaign-decision.service';

// 沿用 standalone.ts 的 growth 身份认证，与现有决策 API 一致。
@Controller('api/growth-decision')
export class CampaignDecisionController {
  constructor(private readonly service: CampaignDecisionService) {}

  @Get('products/:productId/campaign-board')
  board(@Param('productId') productId: string) {
    return this.service.board(productId);
  }

  @Patch('products/:productId/campaign-policy')
  policy(
    @Param('productId') productId: string,
    @Body() body: CampaignDecisionPolicy,
  ) {
    return this.service.updatePolicy(productId, body);
  }

  @Post('products/:productId/campaign-analysis')
  analyze(
    @Param('productId') productId: string,
    @Body() body: { key: string; revision: string },
  ) {
    return this.service.analyze(productId, body?.key, body?.revision);
  }

  @Post('products/:productId/campaign-decisions')
  decide(
    @Param('productId') productId: string,
    @Body() body: DecideCampaignRequest,
  ) {
    return this.service.decide(productId, body);
  }

  @Post('campaign-orders/:id/executed')
  execute(@Param('id') id: string, @Body() body: ExecuteCampaignRequest) {
    return this.service.execute(id, body);
  }
}
