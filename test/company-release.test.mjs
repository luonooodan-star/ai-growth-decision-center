import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  activateRelease,
  readRelease,
  writeRelease,
  releaseDirectory,
  verifyRelease,
} from '../scripts/company-mac/release-paths.mjs';
const id = '0123456789ab-1791800000000';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'growth-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = releaseDirectory(root, id);
  for (const [path, content] of Object.entries({
    'dist/server/standalone.js': '',
    'dist/client/index.html': '<script src="/assets/app.js"></script>',
    'dist/client/assets/app.js': '',
    'node_modules/@nestjs/core/package.json': '{}',
  })) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
  writeFileSync(join(root, 'runtime/keep.sqlite'), 'untouched');
  return { root, directory };
}
test('rejects traversal or malformed release ids', () => {
  for (const id of ['../elsewhere', '/tmp', '', null])
    assert.throws(() => releaseDirectory('/tmp', id));
});
test('verifies assets before activation; preserves current pointer on invalid build', async (t) => {
  const { root, directory } = fixture(t);
  writeFileSync(
    join(directory, 'dist/client/index.html'),
    '<script src="/assets/missing.js"></script>',
  );
  let restarted = false;
  await assert.rejects(
    activateRelease(
      root,
      { id },
      {
        restart: async () => {
          restarted = true;
        },
        healthy: async () => true,
      },
    ),
  );
  assert.equal(readRelease(root), null);
  assert.equal(restarted, false);
});
test('successful activation requires new version readiness and preserves runtime', async (t) => {
  const { root, directory } = fixture(t);
  verifyRelease(directory);
  const seen = [];
  await activateRelease(
    root,
    { id },
    {
      restart: async () => seen.push('restart'),
      healthy: async (expected) => {
        seen.push(expected);
        return true;
      },
    },
  );
  assert.deepEqual(readRelease(root), { id });
  assert.deepEqual(seen, ['restart', id]);
  assert.equal(
    readFileSync(join(root, 'runtime/keep.sqlite'), 'utf8'),
    'untouched',
  );
});
test('failed readiness restores legacy pointer and restarts old server', async (t) => {
  const { root } = fixture(t);
  const seen = [];
  await assert.rejects(
    activateRelease(
      root,
      { id },
      {
        restart: async () => seen.push('restart'),
        healthy: async (expected) => {
          seen.push(expected);
          return expected === 'legacy';
        },
      },
    ),
    /已恢复旧版本/,
  );
  assert.equal(readRelease(root), null);
  assert.deepEqual(seen, ['restart', id, 'restart', 'legacy']);
});
test('failed restart rolls back an existing release pointer', async (t) => {
  const { root } = fixture(t);
  const old = { id: 'aaaaaaaaaaaa-1791700000000' };
  writeRelease(root, old);
  let restarts = 0;
  await assert.rejects(
    activateRelease(
      root,
      { id },
      {
        restart: async () => {
          if (++restarts === 1) throw new Error('launchctl failed');
        },
        healthy: async (expected) => expected === old.id,
      },
    ),
    /已恢复旧版本/,
  );
  assert.deepEqual(readRelease(root), old);
  assert.deepEqual(
    JSON.parse(
      readFileSync(join(root, 'runtime/previous-release.json'), 'utf8'),
    ),
    old,
  );
});
