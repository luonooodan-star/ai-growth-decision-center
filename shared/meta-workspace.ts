/** Public origins only: never accept credentials, paths, queries or insecure URLs. */
export function metaWorkspaceOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function canEmbedMetaWorkspace(
  center: string,
  workspace: string,
): boolean {
  const target = metaWorkspaceOrigin(workspace);
  const parent = metaWorkspaceOrigin(center);
  return Boolean(
    target && parent && new URL(target).hostname === new URL(parent).hostname,
  );
}

// These are existing UI routes, not a second implementation of the Meta API.
export const META_WORKSPACE_SECTIONS = [
  { label: '素材库', path: '/' },
  { label: '应用配置', path: '/app-configs' },
  { label: '广告配置模板', path: '/ad-upload' },
  { label: '粉丝页配置', path: '/page-configs' },
  { label: '受众生成库', path: '/audiences' },
  { label: '广告发布任务', path: '/ad-tasks' },
] as const;
