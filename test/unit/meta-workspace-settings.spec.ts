import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadMetaWorkspaceSettings,
  validateMetaWorkspaceSettings,
} from '@server/common/utils/meta-workspace-settings';

const valid = {
  GROWTH_META_WORKSPACE_ORIGIN: 'https://company.test:3001',
  GROWTH_SECURE_CENTER_ORIGIN: 'https://company.test:8443',
  GROWTH_HTTPS_PORT: '8443',
  GROWTH_TLS_CERT_PATH: '/test/cert.pem',
  GROWTH_TLS_KEY_PATH: '/test/key.pem',
};
describe('persistent Meta workspace settings', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'meta-settings-test-'));
    mkdirSync(join(root, 'runtime'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  function save(value: unknown) {
    writeFileSync(
      join(root, 'runtime/meta-workspace.json'),
      JSON.stringify(value),
    );
  }
  test('absent file leaves current environment unchanged', () => {
    const env = { EXISTING: 'value' };
    expect(loadMetaWorkspaceSettings(env, root)).toBe(false);
    expect(env).toEqual({ EXISTING: 'value' });
  });
  test('loads persisted settings while preserving credentials and explicit overrides', () => {
    save(valid);
    const env = {
      META_APP_SECRET: 'sentinel',
      GROWTH_TLS_KEY_PATH: '/override/key.pem',
    };
    expect(loadMetaWorkspaceSettings(env, root)).toBe(true);
    expect(env).toMatchObject({
      ...valid,
      META_APP_SECRET: 'sentinel',
      GROWTH_TLS_KEY_PATH: '/override/key.pem',
    });
  });
  test.each([
    { ...valid, META_APP_SECRET: 'not-allowed' },
    { ...valid, GROWTH_HTTPS_PORT: '443' },
    { ...valid, GROWTH_SECURE_CENTER_ORIGIN: 'https://other.test:8443' },
    { ...valid, GROWTH_TLS_KEY_PATH: './key' },
    {
      ...valid,
      GROWTH_META_WORKSPACE_ORIGIN: 'https://secret@company.test:3001',
    },
  ])('rejects invalid settings without changing environment', (value) => {
    save(value);
    const env = {};
    expect(() => loadMetaWorkspaceSettings(env, root)).toThrow();
    expect(env).toEqual({});
  });
  test('rejects conflicting environment override atomically', () => {
    save(valid);
    const env = { GROWTH_HTTPS_PORT: '9000' };
    expect(() => loadMetaWorkspaceSettings(env, root)).toThrow();
    expect(env).toEqual({ GROWTH_HTTPS_PORT: '9000' });
  });
  test('normalizes valid origins', () => {
    expect(
      validateMetaWorkspaceSettings({
        ...valid,
        GROWTH_META_WORKSPACE_ORIGIN: valid.GROWTH_META_WORKSPACE_ORIGIN + '/',
      }),
    ).toEqual(valid);
  });
});
