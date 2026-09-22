import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function readMetaLocalBridge(
  root = process.cwd(),
): { origin: string; secret: string; workspaceOrigin?: string } | null {
  const file = join(root, 'runtime/meta-local-bridge.json');
  if (!existsSync(file)) return null;
  if (statSync(file).mode & 0o077) throw new Error('本机桥配置权限必须为 0600');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  const url = new URL(config.origin);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{64}$/.test(config.secret)
  )
    throw new Error('本机桥配置无效，已阻止连接');
  return {
    origin: url.origin,
    secret: config.secret,
    workspaceOrigin: config.workspaceOrigin,
  };
}
