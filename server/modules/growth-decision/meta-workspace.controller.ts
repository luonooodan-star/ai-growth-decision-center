import { Controller, Get } from '@nestjs/common';
import type { MetaWorkspaceConfig } from '@shared/api.interface';
import { getMetaWorkspaceConfig } from './meta-workspace-config';

@Controller('api/growth-decision/meta-workspace')
export class MetaWorkspaceController {
  @Get('config') config(): MetaWorkspaceConfig {
    return getMetaWorkspaceConfig(process.env);
  }
}
