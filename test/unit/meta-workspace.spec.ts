import {
  canEmbedMetaWorkspace,
  metaWorkspaceOrigin,
  META_WORKSPACE_SECTIONS,
} from '@shared/meta-workspace';
import { getMetaWorkspaceConfig } from '@server/modules/growth-decision/meta-workspace-config';
import { readOptionalHttps } from '@server/common/utils/optional-https';

describe('original Meta workspace integration', () => {
  test('only HTTPS origins, never credentials, paths or query tokens', () => {
    expect(metaWorkspaceOrigin('https://company.test:3001/')).toBe(
      'https://company.test:3001',
    );
    for (const url of [
      'http://company.test',
      'javascript:alert(1)',
      'https://key@company.test',
      'https://company.test?token=secret',
      'https://company.test/ad-tasks',
      'https://company.test/#secret',
    ]) {
      expect(metaWorkspaceOrigin(url)).toBeNull();
    }
  });
  test('embedding requires HTTPS and same hostname, permits original port', () => {
    expect(
      canEmbedMetaWorkspace(
        'https://company.test:8443',
        'https://company.test:3001',
      ),
    ).toBe(true);
    expect(
      canEmbedMetaWorkspace(
        'http://company.test:8081',
        'https://company.test:3001',
      ),
    ).toBe(false);
    expect(
      canEmbedMetaWorkspace('https://other.test', 'https://company.test:3001'),
    ).toBe(false);
  });
  test('configuration exposes only public origins, not Meta credentials', () => {
    const before = { ...process.env };
    try {
      process.env.GROWTH_META_WORKSPACE_ORIGIN = 'https://company.test:3001';
      process.env.GROWTH_SECURE_CENTER_ORIGIN = 'https://company.test:8443';
      process.env.META_APP_SECRET = 'test-secret';
      expect(getMetaWorkspaceConfig(process.env)).toEqual({
        workspaceOrigin: 'https://company.test:3001',
        secureCenterOrigin: 'https://company.test:8443',
        error: null,
      });
      delete process.env.GROWTH_META_WORKSPACE_ORIGIN;
      expect(getMetaWorkspaceConfig(process.env).workspaceOrigin).toBeNull();
    } finally {
      process.env = before;
    }
  });
  test('existing UI routes only, no auto-executing process endpoints', () => {
    expect(META_WORKSPACE_SECTIONS.map((section) => section.path)).toEqual([
      '/',
      '/app-configs',
      '/ad-upload',
      '/page-configs',
      '/audiences',
      '/ad-tasks',
    ]);
  });
  test('HTTPS is opt-in; partial configuration cannot silently downgrade', () => {
    expect(readOptionalHttps({})).toBeNull();
    expect(() => readOptionalHttps({ GROWTH_HTTPS_PORT: '8443' })).toThrow(
      '配置不完整',
    );
    expect(() =>
      readOptionalHttps({
        GROWTH_HTTPS_PORT: '0',
        GROWTH_TLS_CERT_PATH: 'cert',
        GROWTH_TLS_KEY_PATH: 'key',
      }),
    ).toThrow('配置不完整');
  });
});
