// Node-side Vite adapter. Meta tokens are decrypted only by the unchanged uploader API.
import { createServer } from 'node:http';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  renameSync,
} from 'node:fs';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

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
  // Do not migrate the legacy shared authorization to any personal account.
  const sessionFile = `${configFile}.users`;
  const nonce = randomBytes(32).toString('hex');
  const reply = (res, status, value) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(value));
  };
  let saved = { sessions: {}, used: {} };
  if (existsSync(sessionFile)) {
    if (statSync(sessionFile).mode & 0o077)
      throw new Error('本机授权文件必须为 0600');
    saved = JSON.parse(readFileSync(sessionFile, 'utf8'));
  }
  const persist = (next) => {
    for (const [id, until] of Object.entries(next.used))
      if (until <= Date.now()) delete next.used[id];
    const temporary = `${sessionFile}.${randomBytes(8).toString('hex')}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), {
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporary, sessionFile);
    saved = next;
  };
  const readTicket = (req) => {
    try {
      const ticket =
        new URL(req.url, workspace.origin).searchParams.get('ticket') || '';
      if (ticket.length > 1000) return null;
      const [payload, signature] = ticket.split('.');
      if (
        !equal(
          signature,
          createHmac('sha256', config.secret).update(payload).digest('hex'),
        )
      )
        return null;
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (
        !/^[a-zA-Z0-9_-]{1,40}$/.test(value.username) ||
        !/^[a-f0-9-]{36}$/.test(value.id) ||
        !Number.isFinite(value.until) ||
        value.until <= Date.now() ||
        value.until > Date.now() + 5 * 60000 ||
        Object.hasOwn(saved.used, value.id)
      )
        return null;
      return value;
    } catch {
      return null;
    }
  };
  // Explicit browser consent, served only by the existing HTTPS uploader.
  server.middlewares.use((req, res, next) => {
    if (req.url?.split('?')[0] !== '/growth-center-link') return next();
    if (requestAuthority(req.headers) !== workspace.host)
      return reply(res, 403, { error: '请使用原工具配置地址打开授权页' });
    const ticket = readTicket(req);
    if (!ticket)
      return reply(res, 403, {
        error:
          '请从决策中心当前用户的「绑定我的 Meta」进入，链接有效期 5 分钟且仅可使用一次',
      });
    const session = Object.hasOwn(saved.sessions, ticket.username)
      ? saved.sessions[ticket.username]
      : null;
    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        // Same-origin forms need a non-opaque Origin; never send the ticket cross-origin.
        'Referrer-Policy': 'same-origin',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      });
      res.end(`<!doctype html><meta charset="utf-8"><title>连接决策中心</title>
        <main style="font-family:system-ui;max-width:650px;margin:60px auto;line-height:1.8">
        <h1>连接决策中心 · ${ticket.username}</h1><p>请先在原工具登录你本人的 Meta，再点击授权。若显示的是他人登录，请先在原工具退出并切换。</p>
        <p>本次授权仅供决策中心用户 ${ticket.username} 使用，不会覆盖其他人的授权。
        加密会话仅保存在公司 Mac 本机，Meta key 不变。授权有效期最多 7 天，Meta 登录失效时需重新授权。</p>
        <p>当前：${session && session.until > Date.now() ? '已保存个人授权，请返回决策中心「授权与连接」检测有效性' : '未授权或已过期'}。本页不会修改广告。</p>
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
      if (Object.hasOwn(saved.used, ticket.id) || ticket.until <= Date.now())
        return reply(res, 403, {
          error: '链接已使用或过期，请从决策中心重新进入',
        });
      if (form.get('action') === 'revoke') {
        const next = {
          sessions: { ...saved.sessions },
          used: { ...saved.used, [ticket.id]: ticket.until },
        };
        delete next.sessions[ticket.username];
        try {
          persist(next);
        } catch {
          return reply(res, 500, { error: '撤销未保存，请重试；原授权仍有效' });
        }
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
        persist({
          sessions: { ...saved.sessions, [ticket.username]: value },
          used: { ...saved.used, [ticket.id]: ticket.until },
        });
        reply(res, 200, {
          message: `已保存 ${ticket.username} 的独立授权。回到决策中心刷新；实际 Meta 权限将在预检时核验。`,
        });
      } catch {
        reply(res, 500, { error: '无法保存本机授权' });
      }
    });
  });
  const bridge = createServer((req, res) => {
    res.setHeader('X-Growth-Identity-Version', '2');
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
    const username = req.headers['x-growth-user'];
    const session =
      typeof username === 'string' &&
      /^[a-zA-Z0-9_-]{1,40}$/.test(username) &&
      Object.hasOwn(saved.sessions, username)
        ? saved.sessions[username]
        : null;
    if (!session || session.until <= Date.now())
      return reply(res, 401, {
        error: '当前用户尚未绑定 Meta，请从决策中心点击「绑定我的 Meta」',
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
          if (
            saved.sessions[username] !== session ||
            session.until <= Date.now()
          )
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
