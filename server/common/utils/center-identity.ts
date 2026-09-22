import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scryptSync, timingSafeEqual } from 'node:crypto';

export const centerIdentity = new AsyncLocalStorage<string>();
export function authenticateCenter(
  username: string,
  password: string,
  legacyPassword: string,
  root = process.cwd(),
): boolean {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(username) || password.length > 1024)
    return false;
  const file = join(root, 'runtime/center-users.json');
  if (existsSync(file)) {
    if (statSync(file).mode & 0o077) throw new Error('用户配置权限必须为 0600');
    const users = JSON.parse(readFileSync(file, 'utf8')) as Record<
      string,
      { salt: string; hash: string; disabled?: boolean }
    >;
    const user = Object.hasOwn(users, username) ? users[username] : undefined;
    if (user) {
      if (
        user.disabled ||
        !/^[a-f0-9]{32}$/.test(user.salt) ||
        !/^[a-f0-9]{128}$/.test(user.hash)
      )
        return false;
      return timingSafeEqual(
        scryptSync(password, user.salt, 64),
        Buffer.from(user.hash, 'hex'),
      );
    }
  }
  const a = Buffer.from(password),
    b = Buffer.from(legacyPassword);
  return (
    username === 'growth' &&
    b.length >= 12 &&
    a.length === b.length &&
    timingSafeEqual(a, b)
  );
}
