import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
export type CenterRole = 'operator' | 'designer';
export async function readCenterRole(
  username: string,
  root = process.cwd(),
): Promise<CenterRole> {
  const file = join(root, 'runtime/center-users.json');
  try {
    if ((await stat(file)).mode & 0o077)
      throw new Error('用户配置权限必须为 0600');
    const users = JSON.parse(await readFile(file, 'utf8'));
    const user = Object.hasOwn(users, username) ? users[username] : undefined;
    if (!user && username === 'growth') return 'operator';
    if (
      !user ||
      user.disabled ||
      (user.role !== undefined && !['operator', 'designer'].includes(user.role))
    )
      throw new Error('用户角色无效');
    return user.role || 'operator';
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' &&
      username === 'growth'
    )
      return 'operator';
    throw error;
  }
}
export function designerApiAllowed(method: string, path: string): boolean {
  if (path === '/api/center/doris')
    return method === 'GET' || method === 'POST';
  return (
    method === 'GET' &&
    [
      '/api/center/me',
      '/api/growth-decision/bi/day',
      '/api/growth-decision/bi/channel-spend',
      '/api/growth-decision/bi/products',
      '/api/growth-decision/bi/products/options',
      '/api/growth-decision/bi/standards',
    ].includes(path)
  );
}
