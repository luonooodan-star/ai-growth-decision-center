import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { scrypt, createHmac, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

const verifierSecret = randomBytes(32);
const verified = new Map<string, number>();
const verifying = new Map<string, Promise<boolean>>();
let activeVerifiers = 0;
const verifierQueue: (() => void)[] = [];

/** A session is invalid after any user configuration/password change. */
export async function centerCredentialRevision(
  legacy: string,
  root = process.cwd(),
): Promise<string> {
  let raw = '';
  try {
    const file = join(root, 'runtime/center-users.json');
    if ((await stat(file)).mode & 0o077) return '';
    raw = await readFile(file, 'utf8');
    JSON.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return '';
  }
  return createHmac('sha256', verifierSecret)
    .update(JSON.stringify([root, raw, legacy]))
    .digest('hex');
}

// Production requests use asynchronous scrypt, not the event-loop-blocking
// verifier below. Only successful results are cached; each request rereads user
// configuration so disable/password changes immediately invalidate reuse.
export async function authenticateCenterAsync(
  username: string,
  password: string,
  legacyPassword: string,
  root = process.cwd(),
): Promise<boolean> {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(username) || password.length > 1024)
    return false;
  const file = join(root, 'runtime/center-users.json');
  let raw: string;
  try {
    const info = await stat(file);
    if (info.mode & 0o077) return false;
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
    const a = Buffer.from(password),
      b = Buffer.from(legacyPassword);
    return (
      username === 'growth' &&
      b.length >= 12 &&
      a.length === b.length &&
      timingSafeEqual(a, b)
    );
  }
  let users: Record<string, { salt: string; hash: string; disabled?: boolean }>;
  try {
    users = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!users || typeof users !== 'object') return false;
  const user = Object.hasOwn(users, username) ? users[username] : undefined;
  if (!user) {
    const a = Buffer.from(password),
      b = Buffer.from(legacyPassword);
    return (
      username === 'growth' &&
      b.length >= 12 &&
      a.length === b.length &&
      timingSafeEqual(a, b)
    );
  }
  if (
    user.disabled ||
    !/^[a-f0-9]{32}$/.test(user.salt) ||
    !/^[a-f0-9]{128}$/.test(user.hash)
  )
    return false;
  const key = createHmac('sha256', verifierSecret)
    .update(JSON.stringify([root, username, user.salt, user.hash, password]))
    .digest('hex');
  if ((verified.get(key) || 0) > Date.now()) return true;
  if (verifying.has(key)) return verifying.get(key)!;
  if (verifying.size >= 128) return false;
  const task = (async () => {
    if (activeVerifiers >= 2)
      await new Promise<void>((resolve) => verifierQueue.push(resolve));
    else activeVerifiers++;
    try {
      const derived = await new Promise<Buffer>((resolve, reject) =>
        scrypt(password, user.salt, 64, (error, value) =>
          error ? reject(error) : resolve(value),
        ),
      );
      const valid = timingSafeEqual(derived, Buffer.from(user.hash, 'hex'));
      if (
        !valid ||
        (await readFile(file, 'utf8')) !== raw ||
        (await stat(file)).mode & 0o077
      )
        return false;
      verified.set(key, Date.now() + 30000);
      while (verified.size > 256)
        verified.delete(verified.keys().next().value!);
      return true;
    } catch {
      return false;
    } finally {
      const next = verifierQueue.shift();
      if (next) next();
      else activeVerifiers--;
    }
  })();
  verifying.set(key, task);
  try {
    return await task;
  } finally {
    verifying.delete(key);
  }
}

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
