import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { createServer, type ServerOptions, type Server } from 'node:https';
import type { RequestListener } from 'node:http';

export function readOptionalHttps(
  env: NodeJS.ProcessEnv,
): { port: number; options: ServerOptions } | null {
  if (
    !env.GROWTH_HTTPS_PORT &&
    !env.GROWTH_TLS_CERT_PATH &&
    !env.GROWTH_TLS_KEY_PATH
  )
    return null;
  const port = Number(env.GROWTH_HTTPS_PORT);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !env.GROWTH_TLS_CERT_PATH ||
    !env.GROWTH_TLS_KEY_PATH
  ) {
    throw new Error(
      'HTTPS 配置不完整：需要有效 GROWTH_HTTPS_PORT、GROWTH_TLS_CERT_PATH 和 GROWTH_TLS_KEY_PATH',
    );
  }
  const options: ServerOptions = {
    cert: readFileSync(env.GROWTH_TLS_CERT_PATH),
    key: readFileSync(env.GROWTH_TLS_KEY_PATH),
    minVersion: 'TLSv1.2',
  };
  // Validate before opening either listener; never silently fall back to HTTP.
  createSecureContext(options);
  if (port === Number(env.SERVER_PORT || 8081))
    throw new Error('HTTPS 端口不能与 HTTP 端口相同');
  const certificate = new X509Certificate(options.cert as Buffer);
  const now = Date.now();
  if (
    now < Date.parse(certificate.validFrom) ||
    now >= Date.parse(certificate.validTo)
  )
    throw new Error('HTTPS 证书尚未生效或已过期');
  if (env.GROWTH_SECURE_CENTER_ORIGIN) {
    const hostname = new URL(env.GROWTH_SECURE_CENTER_ORIGIN).hostname.replace(
      /^\[|\]$/g,
      '',
    );
    const matches = isIP(hostname)
      ? certificate.checkIP(hostname)
      : certificate.checkHost(hostname);
    if (!matches) throw new Error('HTTPS 证书未覆盖决策中心入口主机名');
  }
  return { port, options };
}

export async function startOptionalHttps(
  config: ReturnType<typeof readOptionalHttps>,
  host: string,
  listener: RequestListener,
): Promise<Server | null> {
  if (!config) return null;
  const server = createServer(config.options, listener);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}
