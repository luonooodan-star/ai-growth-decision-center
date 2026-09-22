import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Req,
  Body,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { centerIdentity } from '../../common/utils/center-identity';
import {
  personalDorisStatus,
  savePersonalDoris,
} from '../../common/utils/personal-doris';

@Controller('api/center/doris')
export class PersonalDorisController {
  private username() {
    const username = centerIdentity.getStore();
    if (!username) throw new UnauthorizedException('请使用个人账号登录');
    return username;
  }
  @Get() status() {
    return personalDorisStatus(this.username());
  }
  @Post() save(
    @Req() req: Request,
    @Body() body: { key?: string; revoke?: boolean },
  ) {
    if (
      !req.headers.origin ||
      new URL(req.headers.origin).host !== req.headers.host ||
      !req.is('application/json')
    )
      throw new BadRequestException('仅允许本站设置个人授权');
    const username = this.username();
    if (body.revoke !== true && typeof body.key !== 'string')
      throw new BadRequestException('请填写自己的 Doris Key');
    try {
      return savePersonalDoris(
        username,
        body.revoke === true ? undefined : body.key,
      );
    } catch {
      throw new BadRequestException('Doris Key 格式无效或个人凭据无法安全保存');
    }
  }
}
