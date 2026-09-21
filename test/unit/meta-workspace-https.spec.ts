import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:https';
import type { AddressInfo } from 'node:net';
import {
  readOptionalHttps,
  startOptionalHttps,
} from '@server/common/utils/optional-https';

describe('workspace HTTPS listener', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'workspace-tls-test-'));
    const cert = join(root, 'cert.pem');
    const key = join(root, 'key.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-keyout',
        key,
        '-out',
        cert,
      ],
      { stdio: 'ignore' },
    );
    env = {
      GROWTH_HTTPS_PORT: '8443',
      GROWTH_TLS_CERT_PATH: cert,
      GROWTH_TLS_KEY_PATH: key,
      GROWTH_SECURE_CENTER_ORIGIN: 'https://localhost:8443',
    };
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  test('rejects wrong certificate host and HTTP port collision', () => {
    expect(() =>
      readOptionalHttps({
        ...env,
        GROWTH_SECURE_CENTER_ORIGIN: 'https://other.test:8443',
      }),
    ).toThrow('未覆盖');
    expect(() => readOptionalHttps({ ...env, SERVER_PORT: '8443' })).toThrow(
      '不能与 HTTP',
    );
  });
  test('serves same handler through a trusted isolated TLS connection', async () => {
    const config = readOptionalHttps(env)!;
    const server = await startOptionalHttps(
      { ...config, port: 0 },
      '127.0.0.1',
      (_req, res) => res.end('shared-handler'),
    );
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const request = get(
          {
            hostname: '127.0.0.1',
            servername: 'localhost',
            port: (server!.address() as AddressInfo).port,
            ca: readFileSync(env.GROWTH_TLS_CERT_PATH!),
          },
          (response) => {
            let text = '';
            response.on('data', (chunk) => {
              text += chunk;
            });
            response.on('end', () => resolve(text));
          },
        );
        request.setTimeout(3000, () =>
          request.destroy(new Error('TLS test timed out')),
        );
        request.on('error', reject);
      });
      expect(body).toBe('shared-handler');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
