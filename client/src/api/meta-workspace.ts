import axios from 'axios';
import type { MetaWorkspaceConfig } from '@shared/api.interface';

export async function getMetaWorkspaceConfig(): Promise<MetaWorkspaceConfig> {
  return (
    await axios.get<MetaWorkspaceConfig>(
      '/api/growth-decision/meta-workspace/config',
      {
        timeout: 15000,
      },
    )
  ).data;
}
