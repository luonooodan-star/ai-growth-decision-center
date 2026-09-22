import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import {
  authenticateCenter,
  centerIdentity,
} from '@server/common/utils/center-identity';

test('personal password hashes, disabled users and legacy login remain separate', () => {
  const root = mkdtempSync(join(tmpdir(), 'center-users-test-'));
  try {
    mkdirSync(join(root, 'runtime'));
    const salt = 'a'.repeat(32),
      password = 'fixture-password-only';
    const user = { salt, hash: scryptSync(password, salt, 64).toString('hex') };
    writeFileSync(
      join(root, 'runtime/center-users.json'),
      JSON.stringify({ fjx: user, disabled: { ...user, disabled: true } }),
      { mode: 0o600 },
    );
    expect(authenticateCenter('fjx', password, 'legacy-password', root)).toBe(
      true,
    );
    expect(
      authenticateCenter('fjx', 'legacy-password', 'legacy-password', root),
    ).toBe(false);
    expect(
      authenticateCenter('disabled', password, 'legacy-password', root),
    ).toBe(false);
    expect(
      authenticateCenter('growth', 'legacy-password', 'legacy-password', root),
    ).toBe(true);
    expect(
      authenticateCenter('constructor', password, 'legacy-password', root),
    ).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('concurrent user contexts stay isolated including asynchronous work', async () => {
  const values = await Promise.all(
    ['growth', 'fjx'].map((name) =>
      centerIdentity.run(name, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return centerIdentity.getStore();
      }),
    ),
  );
  expect(values).toEqual(['growth', 'fjx']);
});
