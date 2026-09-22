// Run after npm run build:company. Uses an isolated database, fixture credentials,
// loopback only, and no Meta/Doris credentials or advertising requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { scryptSync } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

test(
  'company HTTP login, switch, logout, CSRF and stale-tab isolation',
  { timeout: 30000 },
  async () => {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const root = mkdtempSync(join(tmpdir(), 'center-http-test-'));
    mkdirSync(join(root, 'runtime'));
    const salt = 'd'.repeat(32),
      password = 'fixture-password-only';
    const user = { salt, hash: scryptSync(password, salt, 64).toString('hex') };
    writeFileSync(
      join(root, 'runtime/center-users.json'),
      JSON.stringify({ alice: user, bob: user }),
      { mode: 0o600 },
    );
    const child = spawn(
      process.execPath,
      [resolve('dist/server/standalone.js')],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          SERVER_HOST: '127.0.0.1',
          SERVER_PORT: String(port),
          GROWTH_BASIC_AUTH_PASSWORD: 'fixture-legacy-password',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        output = (output + chunk).slice(-8000);
      });
    const origin = `http://127.0.0.1:${port}`;
    const request = (path, options = {}) =>
      fetch(origin + path, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        ...options,
      });
    try {
      let ready = false;
      for (let i = 0; i < 150; i++) {
        try {
          if ((await request('/health/live')).ok) {
            ready = true;
            break;
          }
        } catch {
          /* startup */
        }
        if (child.exitCode !== null) break;
        await delay(100);
      }
      assert.ok(ready, output);
      assert.equal((await request('/data')).status, 302);
      const page = await request('/login');
      assert.equal(page.status, 200);
      assert.match(await page.text(), /autocomplete="current-password"/);
      const login = (username, cookie, source = origin) =>
        request('/api/center/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: source,
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify({ username, password }),
        });
      assert.equal(
        (await login('alice', undefined, 'https://evil.example')).status,
        403,
      );
      const first = await login('alice');
      assert.equal(first.status, 200);
      assert.match(
        first.headers.get('set-cookie'),
        /HttpOnly; SameSite=Strict/,
      );
      const a = first.headers.get('set-cookie').split(';')[0];
      const me = await (
        await request('/api/center/me', { headers: { Cookie: a } })
      ).json();
      assert.equal(me.username, 'alice');
      assert.ok(me.sessionId);
      const postJson = (path, body) =>
        request(path, {
          method: 'POST',
          headers: {
            Cookie: a,
            Origin: origin,
            'X-Center-Session': me.sessionId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      // Exercise real Nest controllers, not only the standalone login middleware.
      const saved = await postJson('/api/center/doris', {
        key: 'fixture-doris-token-not-real',
      });
      assert.equal(
        saved.status,
        201,
        'JSON body must reach the personal Doris controller',
      );
      const inspected = await postJson(
        '/api/growth-decision/adjustments/inspect',
        {
          target: {
            id: '123',
            campaignId: '123',
            accountId: '456',
            level: 'campaign',
          },
          creative: false,
        },
      );
      assert.equal(
        inspected.status,
        400,
        'Without a bridge, a parsed inspect request must return configuration error, not 500',
      );
      assert.match(
        (await inspected.json()).error.message,
        /未配置原广告服务地址/,
      );
      const second = await login('bob', a);
      assert.equal(second.status, 200);
      const b = second.headers.get('set-cookie').split(';')[0];
      assert.equal(
        (await request('/api/center/me', { headers: { Cookie: a } })).status,
        401,
      );
      assert.equal(
        (
          await (
            await request('/api/center/me', { headers: { Cookie: b } })
          ).json()
        ).username,
        'bob',
      );
      assert.equal(
        (
          await request('/api/center/me', {
            method: 'POST',
            headers: {
              Cookie: b,
              Origin: origin,
              'X-Center-Session': me.sessionId,
            },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request('/api/center/me', {
            method: 'POST',
            headers: { Cookie: b, Origin: origin },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request('/api/center/logout', {
            method: 'POST',
            headers: { Cookie: b, Origin: 'https://evil.example' },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request('/api/center/logout', {
            method: 'POST',
            headers: { Cookie: b, Origin: origin },
          })
        ).status,
        200,
      );
      assert.equal(
        (await request('/api/center/me', { headers: { Cookie: b } })).status,
        401,
      );
      assert.equal(
        (
          await request('/api/center/me', {
            headers: {
              Authorization:
                'Basic ' + Buffer.from('bob:' + password).toString('base64'),
              'Sec-Fetch-Mode': 'navigate',
            },
          })
        ).status,
        401,
      );
    } finally {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(3000),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise((resolve) => child.once('exit', resolve));
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);
