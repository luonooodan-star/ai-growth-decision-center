import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMetaLocalBridge } from '../../server/modules/growth-decision/meta-local-bridge';
import { mkdirSync } from 'node:fs';

test('local bridge fails closed for public destinations and insecure config permissions', () => {
  const root = mkdtempSync(join(tmpdir(), 'meta-local-config-'));
  expect(readMetaLocalBridge(root)).toBeNull();
  mkdirSync(join(root, 'runtime'));
  const file = join(root, 'runtime/meta-local-bridge.json');
  const write = (origin: string) =>
    writeFileSync(file, JSON.stringify({ origin, secret: 'a'.repeat(64) }), {
      mode: 0o600,
    });
  for (const origin of [
    'http://192.168.3.173:18761',
    'http://localhost:18761',
    'http://127.0.0.1:18761/a',
    'http://user@127.0.0.1:18761',
  ]) {
    write(origin);
    expect(() => readMetaLocalBridge(root)).toThrow();
  }
  write('http://127.0.0.1:18761');
  expect(readMetaLocalBridge(root)?.origin).toBe('http://127.0.0.1:18761');
  chmodSync(file, 0o644);
  expect(() => readMetaLocalBridge(root)).toThrow();
});
