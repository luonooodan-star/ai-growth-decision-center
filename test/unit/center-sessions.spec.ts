import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { CenterSessions } from '@server/common/utils/center-sessions';

test('sessions isolate users, revoke on logout, config change, expiry and restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'center-session-test-'));
  mkdirSync(join(root, 'runtime'));
  const salt = 'c'.repeat(32);
  const user = {
    salt,
    hash: scryptSync('test-only-password', salt, 64).toString('hex'),
  };
  const save = (users: unknown) =>
    writeFileSync(
      join(root, 'runtime/center-users.json'),
      JSON.stringify(users),
      { mode: 0o600 },
    );
  try {
    save({ alice: user, bob: user });
    const sessions = new CenterSessions('fixture-legacy-password', root);
    expect(await sessions.login('alice', 'wrong')).toBeUndefined();
    const alice = await sessions.login('alice', 'test-only-password');
    const bob = await sessions.login('bob', 'test-only-password');
    expect(alice).not.toEqual(bob);
    expect((await sessions.resolve(alice))?.username).toBe('alice');
    expect((await sessions.resolve(bob))?.username).toBe('bob');
    sessions.logout(alice);
    expect(await sessions.resolve(alice)).toBeUndefined();
    expect((await sessions.resolve(bob))?.username).toBe('bob');
    expect(
      await new CenterSessions('fixture-legacy-password', root).resolve(bob),
    ).toBeUndefined();
    save({ alice: user, bob: { ...user, disabled: true } });
    expect(await sessions.resolve(bob)).toBeUndefined();
    expect(await sessions.login('bob', 'test-only-password')).toBeUndefined();
    const fresh = await sessions.login('alice', 'test-only-password');
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 9 * 3600000);
    try {
      expect(await sessions.resolve(fresh)).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
    expect(await sessions.resolve('invalid')).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
