import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { centerIdentity } from './center-identity';

type Credential = {
  username: string;
  revision: string;
  updatedAt: string;
  encrypted?: string;
  iv?: string;
  tag?: string;
};
export const personalDataIdentity = new AsyncLocalStorage<{
  username: string;
  revision: string;
}>();
const root = () =>
  process.env.GROWTH_PERSONAL_STORAGE_ROOT ||
  join(process.cwd(), 'runtime/personal');
const userId = (username: string) => {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(username)) throw new Error('个人身份无效');
  return createHash('sha256').update(username).digest('hex');
};
const file = (username: string) => join(root(), `${userId(username)}.json`);
function read(username: string): Credential | undefined {
  const path = file(username);
  if (!existsSync(path)) return;
  if (statSync(path).mode & 0o077)
    throw new Error('个人凭据文件权限必须为 0600');
  const record = JSON.parse(readFileSync(path, 'utf8')) as Credential;
  if (record.username !== username || !/^[a-f0-9-]{36}$/.test(record.revision))
    throw new Error('个人凭据配置无效');
  return record;
}
function masterKey(create = true): Buffer {
  mkdirSync(root(), { recursive: true, mode: 0o700 });
  chmodSync(root(), 0o700);
  const path = join(root(), 'encryption.key');
  if (!existsSync(path) && !create)
    throw new Error('个人凭据加密密钥缺失，已拒绝读取');
  if (!existsSync(path))
    writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' });
  if (statSync(path).mode & 0o077)
    throw new Error('加密密钥文件权限必须为 0600');
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error('加密密钥无效');
  return key;
}
export function personalDorisStatus(username: string) {
  const record = read(username);
  return {
    configured: !!record?.encrypted,
    revision: record?.revision || 'unconfigured',
    updatedAt: record?.updatedAt,
  };
}
export function savePersonalDoris(username: string, token?: string) {
  if (
    token !== undefined &&
    (typeof token !== 'string' ||
      token.trim().length < 8 ||
      token.length > 8192 ||
      /[\r\n]/.test(token))
  )
    throw new Error('Doris Key 格式无效');
  const record: Credential = {
    username,
    revision: randomUUID(),
    updatedAt: new Date().toISOString(),
  };
  const key = masterKey();
  if (token !== undefined) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${username}:${record.revision}`));
    record.encrypted = Buffer.concat([
      cipher.update(token.trim(), 'utf8'),
      cipher.final(),
    ]).toString('base64');
    record.iv = iv.toString('base64');
    record.tag = cipher.getAuthTag().toString('base64');
  }
  const path = file(username),
    temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
  return personalDorisStatus(username);
}
export function readPersonalDorisToken(): string | undefined {
  const scope = personalDataIdentity.getStore();
  if (!scope) {
    if (centerIdentity.getStore() || process.env.GROWTH_PERSONAL_DATA === '1')
      throw new Error('Doris 查询缺少个人数据身份，禁止使用共用凭据');
    return undefined; // Legacy non-standalone jobs/tests only.
  }
  const record = read(scope.username);
  if (!record?.encrypted || record.revision !== scope.revision)
    throw new Error('个人 Doris 授权未配置或已更换，请重新登录页面');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    masterKey(false),
    Buffer.from(record.iv!, 'base64'),
  );
  decipher.setAAD(Buffer.from(`${scope.username}:${record.revision}`));
  decipher.setAuthTag(Buffer.from(record.tag!, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
export const personalScopeKey = () => {
  const scope = personalDataIdentity.getStore();
  return scope ? `${scope.username}:${scope.revision}` : 'legacy-system';
};
export function runPersonalData<T>(username: string, action: () => T): T {
  const { revision } = personalDorisStatus(username);
  return centerIdentity.run(username, () =>
    personalDataIdentity.run({ username, revision }, action),
  );
}
export function configuredDorisUsers(): string[] {
  if (!existsSync(root())) return [];
  const accountsFile = join(process.cwd(), 'runtime/center-users.json');
  const accounts = existsSync(accountsFile)
    ? JSON.parse(readFileSync(accountsFile, 'utf8'))
    : {};
  return readdirSync(root())
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .flatMap((name) => {
      const record = JSON.parse(
        readFileSync(join(root(), name), 'utf8'),
      ) as Credential;
      const active =
        record.username === 'growth' ||
        (Object.hasOwn(accounts, record.username) &&
          !accounts[record.username].disabled);
      return active && personalDorisStatus(record.username).configured
        ? [record.username]
        : [];
    });
}
