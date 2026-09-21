import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  canEmbedMetaWorkspace,
  metaWorkspaceOrigin,
} from '../../../shared/meta-workspace';

export const META_WORKSPACE_KEYS = [
  'GROWTH_META_WORKSPACE_ORIGIN',
  'GROWTH_SECURE_CENTER_ORIGIN',
  'GROWTH_HTTPS_PORT',
  'GROWTH_TLS_CERT_PATH',
  'GROWTH_TLS_KEY_PATH',
] as const;

export function validateMetaWorkspaceSettings(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('工作区配置必须是 JSON 对象');
  const settings = value as Record<string, unknown>;
  if (
    Object.keys(settings).some(
      (key) => !(META_WORKSPACE_KEYS as readonly string[]).includes(key),
    )
  )
    throw new Error('工作区配置含不支持的字段；禁止保存 Meta 凭据');
  if (
    META_WORKSPACE_KEYS.some(
      (key) => typeof settings[key] !== 'string' || !settings[key],
    )
  )
    throw new Error('工作区配置需要完整的地址、HTTPS 端口及证书路径');
  const result = settings as Record<string, string>;
  const workspace = metaWorkspaceOrigin(result.GROWTH_META_WORKSPACE_ORIGIN);
  const center = metaWorkspaceOrigin(result.GROWTH_SECURE_CENTER_ORIGIN);
  if (!workspace || !center || !canEmbedMetaWorkspace(center, workspace))
    throw new Error(
      '工作区与决策中心必须使用相同主机名的 HTTPS 地址，不含路径或凭据',
    );
  const port = Number(result.GROWTH_HTTPS_PORT);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    port !== Number(new URL(center).port || 443) ||
    center === workspace
  )
    throw new Error('HTTPS 端口必须匹配决策中心地址且不能与原工具冲突');
  if (
    !isAbsolute(result.GROWTH_TLS_CERT_PATH) ||
    !isAbsolute(result.GROWTH_TLS_KEY_PATH)
  )
    throw new Error('证书与私钥必须使用绝对路径');
  return {
    ...result,
    GROWTH_META_WORKSPACE_ORIGIN: workspace,
    GROWTH_SECURE_CENTER_ORIGIN: center,
  };
}

// Explicit environment values override persisted non-secret settings.
export function loadMetaWorkspaceSettings(
  env: NodeJS.ProcessEnv,
  root = process.cwd(),
): boolean {
  const file = join(root, 'runtime', 'meta-workspace.json');
  if (!existsSync(file)) return false;
  if (statSync(file).size > 16384) throw new Error('工作区配置文件过大');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('工作区配置文件不是有效 JSON');
  }
  const saved = validateMetaWorkspaceSettings(parsed);
  const effective = { ...saved };
  for (const key of META_WORKSPACE_KEYS)
    if (env[key] !== undefined) effective[key] = env[key]!;
  const validated = validateMetaWorkspaceSettings(effective);
  Object.assign(env, validated);
  return true;
}
