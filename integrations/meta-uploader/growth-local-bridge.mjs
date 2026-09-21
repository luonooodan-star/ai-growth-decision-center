// Node-side Vite adapter. Meta tokens are decrypted only by the unchanged uploader API.
import { createServer } from 'node:http';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const equal = (a, b) => {
  const x = Buffer.from(a || ''),
    y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
};
// HTTPS Vite can negotiate HTTP/2. Its authority is not necessarily duplicated
// into Host; never substitute client-supplied forwarding headers for either.
export function requestAuthority(headers) {
  const host = headers.host;
  const authority = headers[':authority'];
  if (
    (host !== undefined && typeof host !== 'string') ||
    (authority !== undefined && typeof authority !== 'string')
  )
    return null;
  if (host !== undefined && authority !== undefined && host !== authority)
    return null;
  return authority ?? host ?? null;
}
export function growthLocalBridge(configFile) {
  return {
    name: 'growth-local-bridge',
    configureServer(server) {
      install(server, configFile);
    },
  };
}

export function install(server, configFile) {
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  if (statSync(configFile).mode & 0o077)
    throw new Error('本机桥配置必须仅当前用户可读（0600）');
  const endpoint = new URL(config.origin);
  const workspace = new URL(config.workspaceOrigin);
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    !endpoint.port ||
    !/^[a-f0-9]{64}$/.test(config.secret) ||
    workspace.protocol !== 'https:'
  )
    throw new Error('本机桥配置无效');
  const sessionFile = `${configFile}.session`;
  const nonce = randomBytes(32).toString('hex');
  const reply = (res, status, value) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(value));
  };
  let session = null;
  if (existsSync(sessionFile)) {
    if (statSync(sessionFile).mode & 0o077)
      throw new Error('本机授权文件必须为 0600');
    session = JSON.parse(readFileSync(sessionFile, 'utf8'));
  }
  // Explicit browser consent, served only by the existing HTTPS uploader.
  server.middlewares.use((req, res, next) => {
    if (req.url?.split('?')[0] !== '/growth-center-link') return next();
    if (requestAuthority(req.headers) !== workspace.host)
      return reply(res, 403, { error: '请使用原工具配置地址打开授权页' });
    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      });
      res.end(`<!doctype html><meta charset="utf-8"><title>连接决策中心</title>
        <main style="font-family:system-ui;max-width:650px;margin:60px auto;line-height:1.8">
        <h1>连接决策中心</h1><p>请先在原工具登录 Meta，再点击授权。</p>
        <p>授权后，持有决策中心访问密码的优化师可以使用当前 Meta 身份，预检并确认广告调整。
        加密会话仅保存在公司 Mac 本机，Meta key 不变。授权有效期最多 7 天，Meta 登录失效时需重新授权。</p>
        <p>当前：${session && session.until > Date.now() ? '已授权' : '未授权或已过期'}。本页不会修改广告。</p>
        <form method="post"><input type="hidden" name="nonce" value="${nonce}">
        <button name="action" value="bind">授权当前登录给决策中心</button>
        <button name="action" value="revoke">撤销授权</button></form></main>`);
      return;
    }
    if (
      req.method !== 'POST' ||
      req.headers.origin !== workspace.origin ||
      !String(req.headers['content-type']).startsWith(
        'application/x-www-form-urlencoded',
      )
    )
      return reply(res, 403, { error: '仅允许本站确认授权' });
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      const form = new URLSearchParams(body);
      if (!equal(form.get('nonce'), nonce))
        return reply(res, 403, { error: '请重新打开授权页' });
      if (form.get('action') === 'revoke') {
        session = null;
        if (existsSync(sessionFile)) unlinkSync(sessionFile);
        return reply(res, 200, {
          message: '已撤销，后续操作不再授权；已发送的操作无法撤回',
        });
      }
      const cookie = String(req.headers.cookie || '')
        .split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('meta_session='));
      if (form.get('action') !== 'bind' || !cookie || cookie.length > 16384)
        return reply(res, 401, { error: '请先在原广告工具登录，再授权' });
      const value = { cookie, until: Date.now() + 7 * 86400000 };
      try {
        writeFileSync(sessionFile, JSON.stringify(value), { mode: 0o600 });
        session = value;
        reply(res, 200, {
          message:
            '已保存本机授权。回到决策中心 8081 使用；实际权限将在预检时核验。',
        });
      } catch {
        reply(res, 500, { error: '无法保存本机授权' });
      }
    });
  });
  const bridge = createServer((req, res) => {
    if (
      req.socket.remoteAddress !== '127.0.0.1' ||
      req.headers.host !== endpoint.host ||
      !equal(req.headers.authorization, `Bearer ${config.secret}`)
    )
      return reply(res, 403, { error: '本机桥鉴权失败' });
    if (
      req.method !== 'POST' ||
      req.url !== '/api/meta/growth-adjustments' ||
      req.headers['content-type'] !== 'application/json'
    )
      return reply(res, 400, { error: '不支持的本机请求' });
    if (!session || session.until <= Date.now())
      return reply(res, 401, {
        error: '请在原广告工具打开 /growth-center-link 授权当前登录',
      });
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 262144) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      // Recreate the request stream for the existing Vite/Workers middleware stack.
      // No network TLS request, Graph client replacement or token decryption here.
      import('node:stream')
        .then(({ Readable }) => {
          if (!session || session.until <= Date.now())
            return reply(res, 401, { error: '本机授权已撤销或过期' });
          const forwarded = Readable.from([Buffer.concat(chunks)]);
          const headers = {
            host: workspace.host,
            origin: workspace.origin,
            cookie: session.cookie,
            'content-type': 'application/json',
            'content-length': String(bytes),
            'x-forwarded-host': workspace.host,
            'x-forwarded-proto': 'https',
          };
          Object.assign(forwarded, {
            method: 'POST',
            url: '/api/meta/growth-adjustments',
            originalUrl: '/api/meta/growth-adjustments',
            headers,
            rawHeaders: Object.entries(headers).flat(),
            socket: req.socket,
            connection: req.socket,
            httpVersion: '1.1',
          });
          server.middlewares(forwarded, res, () =>
            reply(res, 404, { error: '原广告服务尚未安装调整适配接口' }),
          );
        })
        .catch(() => {
          if (!res.headersSent)
            reply(res, 502, { error: '本机桥请求失败', uncertain: true });
        });
    });
  });
  bridge.requestTimeout = 45000;
  bridge.headersTimeout = 10000;
  bridge.listen(Number(endpoint.port), '127.0.0.1');
  bridge.on('error', () =>
    server.config.logger.error(
      '广告本机桥启动失败，请检查端口占用；不会回退到公开接口',
    ),
  );
  server.httpServer?.once('close', () => bridge.close());
  return bridge;
}
