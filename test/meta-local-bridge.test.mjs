import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
const makeTicket = (secret, username = 'growth') => {
  const payload = Buffer.from(
    JSON.stringify({ username, until: Date.now() + 300000, id: randomUUID() }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`;
};
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import {
  install,
  requestAuthority,
} from '../integrations/meta-uploader/growth-local-bridge.mjs';
import {
  createServer as createHttp2Server,
  connect as connectHttp2,
} from 'node:http2';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test('authority supports HTTP/2 without trusting forwarding headers or conflicting Host', () => {
  assert.equal(
    requestAuthority({ ':authority': '192.168.3.173:3001' }),
    '192.168.3.173:3001',
  );
  assert.equal(
    requestAuthority({ host: '192.168.3.173:3001' }),
    '192.168.3.173:3001',
  );
  assert.equal(
    requestAuthority({ host: 'evil.test', ':authority': '192.168.3.173:3001' }),
    null,
  );
  assert.equal(
    requestAuthority({ 'x-forwarded-host': '192.168.3.173:3001' }),
    null,
  );
  assert.equal(
    requestAuthority({ ':authority': ['192.168.3.173:3001'] }),
    null,
  );
});

test('HTTP/2 authorization page accepts :authority and still rejects wrong origin', async () => {
  let consent;
  const browser = createHttp2Server((req, res) =>
    consent(req, res, () => res.end()),
  );
  browser.listen(0, '127.0.0.1');
  await once(browser, 'listening');
  const port = browser.address().port;
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const bridgePort = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  const dir = mkdtempSync(join(tmpdir(), 'growth-h2-'));
  const file = join(dir, 'config.json');
  writeFileSync(
    file,
    JSON.stringify({
      origin: `http://127.0.0.1:${bridgePort}`,
      workspaceOrigin: `https://127.0.0.1:${port}`,
      secret: 'c'.repeat(64),
    }),
    { mode: 0o600 },
  );
  const middlewares = () => {};
  middlewares.use = (fn) => {
    consent = fn;
  };
  const bridge = install(
    {
      middlewares,
      httpServer: new EventEmitter(),
      config: { logger: { error() {} } },
    },
    file,
  );
  await once(bridge, 'listening');
  const client = connectHttp2(`http://127.0.0.1:${port}`);
  const ticket = makeTicket('c'.repeat(64));
  const request = (headers, body) =>
    new Promise((resolve, reject) => {
      const req = client.request({
        ':path': `/growth-center-link?ticket=${ticket}`,
        ...headers,
      });
      let responseHeaders;
      let status,
        text = '';
      req.on('response', (h) => {
        status = h[':status'];
        responseHeaders = h;
      });
      req.on('data', (chunk) => {
        text += chunk;
      });
      req.on('end', () => resolve({ status, text, headers: responseHeaders }));
      req.on('error', reject);
      req.end(body);
    });
  try {
    const page = await request({ ':method': 'GET' });
    assert.equal(page.status, 200);
    assert.equal(page.headers['referrer-policy'], 'same-origin');
    assert.match(page.text, /授权当前登录/);
    assert.equal(
      (await request({ ':method': 'GET', ':authority': 'evil.test' })).status,
      403,
    );
    const nonce = page.text.match(/name="nonce" value="([a-f0-9]+)"/)[1];
    const body = new URLSearchParams({ nonce, action: 'bind' }).toString();
    const headers = {
      ':method': 'POST',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: 'meta_session=h2-test',
    };
    assert.equal(
      (await request({ ...headers, origin: 'null' }, body)).status,
      403,
    );
    assert.equal(
      (await request({ ...headers, origin: 'https://evil.test' }, body)).status,
      403,
    );
    assert.equal(
      (await request({ ...headers, origin: `https://127.0.0.1:${port}` }, body))
        .status,
      200,
    );
  } finally {
    client.close();
    await new Promise((r) => browser.close(r));
    await new Promise((r) => bridge.close(r));
  }
});

test('installer is repeatable and preserves original credential implementation', () => {
  const base = mkdtempSync(join(tmpdir(), 'growth-bridge-install-'));
  const center = join(base, 'center'),
    uploader = join(base, 'uploader');
  const source = fileURLToPath(new URL('../', import.meta.url));
  for (const path of [
    'scripts/company-mac/setup-meta-local-bridge.mjs',
    'scripts/company-mac/install-adjustment-adapter.mjs',
    'integrations/meta-uploader/growth-local-bridge.mjs',
    'integrations/meta-uploader/growth-adjustments-route.ts',
    'shared/meta-adjustment.ts',
  ]) {
    mkdirSync(dirname(join(center, path)), { recursive: true });
    copyFileSync(join(source, path), join(center, path));
  }
  mkdirSync(join(uploader, 'lib'), { recursive: true });
  writeFileSync(
    join(uploader, 'lib/meta.ts'),
    '// existing credential implementation',
  );
  writeFileSync(join(uploader, '.env.local'), 'SECRET=fixture-not-real');
  writeFileSync(join(uploader, 'package.json'), '{}');
  writeFileSync(
    join(uploader, 'vite.config.ts'),
    'export default { plugins: [vinext()] };',
  );
  const run = () =>
    spawnSync(
      process.execPath,
      [
        join(center, 'scripts/company-mac/setup-meta-local-bridge.mjs'),
        uploader,
      ],
      { encoding: 'utf8' },
    );
  assert.equal(run().status, 0);
  const config = join(center, 'runtime/meta-local-bridge.json');
  const first = readFileSync(config, 'utf8');
  assert.equal(run().status, 0);
  assert.equal(readFileSync(config, 'utf8'), first);
  assert.equal(statSync(config).mode & 0o777, 0o600);
  assert.equal(
    readFileSync(join(uploader, 'vite.config.ts'), 'utf8').match(
      /growthLocalBridge\(/g,
    ).length,
    1,
  );
  assert.equal(
    readFileSync(join(uploader, '.env.local'), 'utf8'),
    'SECRET=fixture-not-real',
  );
  assert.equal(
    readFileSync(join(uploader, 'lib/meta.ts'), 'utf8'),
    '// existing credential implementation',
  );
});

test('local bridge requires local auth, explicit binding; revocation blocks subsequent operations', async () => {
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  const dir = mkdtempSync(join(tmpdir(), 'growth-bridge-test-'));
  const file = join(dir, 'bridge.json');
  const origin = `http://127.0.0.1:${port}`;
  let consent;
  const browser = createServer((req, res) =>
    consent(req, res, () => res.end()),
  );
  browser.listen(0, '127.0.0.1');
  await once(browser, 'listening');
  const workspaceOrigin = `https://127.0.0.1:${browser.address().port}`;
  const secret = 'a'.repeat(64);
  writeFileSync(file, JSON.stringify({ origin, workspaceOrigin, secret }), {
    mode: 0o600,
  });
  let calls = 0;
  let expectedCookie = 'meta_session=encrypted-test-session';
  const middlewares = (req, res) => {
    calls++;
    assert.equal(req.headers.cookie, expectedCookie);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.origin, workspaceOrigin);
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      assert.deepEqual(JSON.parse(data), { action: 'identity' });
      res.end('{"ownerId":"test-user"}');
    });
  };
  middlewares.use = (fn) => {
    consent = fn;
  };
  const server = {
    middlewares,
    httpServer: new EventEmitter(),
    config: { logger: { error: () => {} } },
  };
  const bridge = install(server, file);
  await once(bridge, 'listening');
  const pageBase = `http://127.0.0.1:${browser.address().port}/growth-center-link`;
  let base = `${pageBase}?ticket=${makeTicket(secret)}`;
  const headers = {};
  const post = (auth = true, username = 'growth') =>
    fetch(`${origin}/api/meta/growth-adjustments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-growth-user': username,
        ...(auth ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ action: 'identity' }),
    });
  try {
    assert.equal((await post(false)).status, 403);
    assert.equal((await post()).status, 401);
    assert.equal((await fetch(pageBase)).status, 403);
    assert.equal(
      (await fetch(`${pageBase}?ticket=${makeTicket(secret)}tampered`)).status,
      403,
    );
    const html = await (await fetch(base, { headers })).text();
    const nonce = html.match(/name="nonce" value="([a-f0-9]+)"/)[1];
    const bind = (action, originHeader = workspaceOrigin) =>
      fetch(base, {
        method: 'POST',
        headers: {
          ...headers,
          origin: originHeader,
          cookie: 'meta_session=encrypted-test-session',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ nonce, action }),
      });
    assert.equal((await bind('bind', 'https://evil.example')).status, 403);
    assert.equal((await bind('bind')).status, 200);
    assert.equal(existsSync(`${file}.users`), true);
    assert.equal(
      readFileSync(`${file}.users`, 'utf8').includes('encrypted-test-session'),
      true,
    );
    assert.deepEqual(await (await post()).json(), { ownerId: 'test-user' });
    assert.equal((await post(true, 'fjx')).status, 401);
    assert.equal((await bind('bind')).status, 403); // One-use link.
    const fjxUrl = `${pageBase}?ticket=${makeTicket(secret, 'fjx')}`;
    const fjxPage = await (await fetch(fjxUrl)).text();
    assert.match(fjxPage, /未授权或已过期/);
    assert.equal(calls, 1);
    assert.equal(
      (
        await fetch(fjxUrl, {
          method: 'POST',
          headers: {
            origin: workspaceOrigin,
            cookie: 'meta_session=fjx-private-session',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ nonce, action: 'bind' }),
        })
      ).status,
      200,
    );
    expectedCookie = 'meta_session=fjx-private-session';
    assert.equal((await post(true, 'fjx')).status, 200);
    expectedCookie = 'meta_session=encrypted-test-session';
    assert.equal((await post()).status, 200);
    base = `${pageBase}?ticket=${makeTicket(secret)}`;
    assert.equal((await bind('revoke')).status, 200);
    assert.equal((await post()).status, 401);
    expectedCookie = 'meta_session=fjx-private-session';
    assert.equal((await post(true, 'fjx')).status, 200);
    assert.equal(calls, 4);
  } finally {
    await new Promise((r) => browser.close(r));
    await new Promise((r) => bridge.close(r));
  }
});
