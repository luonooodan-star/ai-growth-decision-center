import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  designerApiAllowed,
  readCenterRole,
} from '@server/common/utils/center-role';
import { centerCredentialRevision } from '@server/common/utils/center-identity';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'designer-role-test-'));
  mkdirSync(join(root, 'runtime'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const save = (data: unknown) =>
  writeFileSync(join(root, 'runtime/center-users.json'), JSON.stringify(data), {
    mode: 0o600,
  });
test('existing users retain operator role, designers are explicit, invalid roles fail closed', async () => {
  save({
    fjx: {},
    zxy: { role: 'designer' },
    cz: { role: 'designer' },
    invalid: { role: 'admin' },
    disabled: { role: 'designer', disabled: true },
  });
  expect(await readCenterRole('growth', root)).toBe('operator');
  expect(await readCenterRole('fjx', root)).toBe('operator');
  for (const user of ['zxy', 'cz'])
    expect(await readCenterRole(user, root)).toBe('designer');
  for (const user of ['invalid', 'disabled', 'missing', 'constructor'])
    await expect(readCenterRole(user, root)).rejects.toThrow();
});
test('designer API allowlist only permits BI reads and personal Doris settings', () => {
  for (const path of [
    '/api/center/me',
    '/api/center/doris',
    '/api/growth-decision/bi/day',
    '/api/growth-decision/bi/products/options',
    '/api/growth-decision/bi/standards',
  ])
    expect(designerApiAllowed('GET', path)).toBe(true);
  expect(designerApiAllowed('POST', '/api/center/doris')).toBe(true);
  for (const path of [
    '/api/growth-decision/dashboard',
    '/api/growth-decision/bi/products/sync',
    '/api/growth-decision/bi/adjustment-day',
    '/api/growth-decision/adjustments/authorization-link',
    '/api/growth-decision/adjustments/authorization-status',
    '/api/growth-decision/adjustments/submit',
    '/api/growth-decision/analysis/query',
    '/api/growth-decision/analysis/mellow-roas',
    '/api/growth-decision/meta-operations/weekly',
    '/mcp/growth-decision',
    '/openapi/growth-decision',
    '/API/GROWTH-DECISION/ADJUSTMENTS/submit',
  ]) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE'])
      expect(designerApiAllowed(method, path)).toBe(false);
  }
});
test('role changes invalidate existing center sessions', async () => {
  save({ zxy: { role: 'operator' } });
  const before = await centerCredentialRevision('test-only-password', root);
  save({ zxy: { role: 'designer' } });
  expect(await centerCredentialRevision('test-only-password', root)).not.toBe(
    before,
  );
});
test('CLI creates zxy and cz as designers; updating role preserves passwords and unknown flags are rejected', () => {
  const directory = join(root, 'scripts/company-mac');
  mkdirSync(directory, { recursive: true });
  const script = join(directory, 'add-center-user.mjs');
  copyFileSync(
    join(process.cwd(), 'scripts/company-mac/add-center-user.mjs'),
    script,
  );
  const run = (args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        GROWTH_NEW_USER_PASSWORD: 'test-only-password-123',
      },
      encoding: 'utf8',
    });
  for (const username of ['zxy', 'cz'])
    expect(run([username, '--role', 'designer']).status).toBe(0);
  const file = join(root, 'runtime/center-users.json');
  const users = JSON.parse(readFileSync(file, 'utf8'));
  expect(users.zxy.role).toBe('designer');
  expect(users.cz.role).toBe('designer');
  expect(readFileSync(file, 'utf8')).not.toContain('test-only-password');
  expect(statSync(file).mode & 0o077).toBe(0);
  expect(run(['zxy', '--role', 'designer']).status).not.toBe(0);
  expect(run(['zxy', '--set-role', '--role', 'operator']).status).toBe(0);
  expect(JSON.parse(readFileSync(file, 'utf8')).zxy.hash).toBe(users.zxy.hash);
  expect(run(['new', '--typo']).status).not.toBe(0);
});
