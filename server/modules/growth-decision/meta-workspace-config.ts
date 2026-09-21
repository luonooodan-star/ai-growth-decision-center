import type { MetaWorkspaceConfig } from '@shared/api.interface';
import { metaWorkspaceOrigin } from '@shared/meta-workspace';

export function getMetaWorkspaceConfig(env: NodeJS.ProcessEnv): MetaWorkspaceConfig {
  const workspaceOrigin = metaWorkspaceOrigin(env.GROWTH_META_WORKSPACE_ORIGIN);
  const secureCenterOrigin = metaWorkspaceOrigin(env.GROWTH_SECURE_CENTER_ORIGIN);
  return {
    workspaceOrigin,
    secureCenterOrigin,
    error: !workspaceOrigin
      ? '尚未配置原广告工具的 HTTPS 地址，请配置 GROWTH_META_WORKSPACE_ORIGIN；无需填写或复制 Meta key。'
      : env.GROWTH_SECURE_CENTER_ORIGIN && !secureCenterOrigin
        ? '安全入口地址格式无效，请检查 GROWTH_SECURE_CENTER_ORIGIN。'
        : null,
  };
}
