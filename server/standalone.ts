import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { json } from 'express';
import { isMellowSharedRoute } from './common/utils/mellow-sharing';
import {
  CenterSessions,
  centerLoginPage,
} from './common/utils/center-sessions';
import { __express as hbsExpressEngine } from 'hbs';
import { authenticateCenterAsync } from './common/utils/center-identity';
import { join } from 'node:path';
import {
  personalDorisStatus,
  runPersonalData,
} from './common/utils/personal-doris';

import { StandaloneAppModule } from './standalone-app.module';
import { loadMetaWorkspaceSettings } from './common/utils/meta-workspace-settings';
import {
  readOptionalHttps,
  startOptionalHttps,
} from './common/utils/optional-https';

function readBasicCredentials(
  authorization: string | undefined,
): { username: string; password: string } | undefined {
  if (!authorization?.startsWith('Basic ')) return undefined;
  try {
    const decoded: string = Buffer.from(
      authorization.slice('Basic '.length),
      'base64',
    ).toString('utf8');
    const separatorIndex: number = decoded.indexOf(':');
    if (separatorIndex < 0) return undefined;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return undefined;
  }
}

async function bootstrap(): Promise<void> {
  process.env.GROWTH_PERSONAL_DATA = '1';
  loadMetaWorkspaceSettings(process.env);
  const httpsConfig = readOptionalHttps(process.env);
  const app: NestExpressApplication =
    await NestFactory.create<NestExpressApplication>(StandaloneAppModule);
  const logger: Logger = new Logger('StandaloneBootstrap');
  const host: string = process.env.SERVER_HOST || '127.0.0.1';
  const port: number = Number(process.env.SERVER_PORT || '8081');
  const accessPassword: string = process.env.GROWTH_BASIC_AUTH_PASSWORD || '';
  const clientDirectory: string =
    process.env.GROWTH_CLIENT_DIRECTORY || join(process.cwd(), 'dist/client');

  if (accessPassword.length < 12) {
    throw new Error('GROWTH_BASIC_AUTH_PASSWORD 至少需要 12 位');
  }

  const sessions = new CenterSessions(accessPassword);
  const loginJson = json({ limit: '4kb' });
  // Nest detects installed parsers by middleware name, without checking the
  // mount path. Mounting jsonParser directly here suppresses its global parser
  // and leaves every other POST controller with an undefined body.
  app.use(
    '/api/center/login',
    (req: Request, res: Response, next: NextFunction) =>
      loginJson(req, res, next),
  );

  app.use(
    async (
      request: Request,
      response: Response,
      next: NextFunction,
    ): Promise<void> => {
      try {
        if (request.path === '/health/live') {
          response.json({
            ok: true,
            releaseId: process.env.GROWTH_RELEASE_ID || 'legacy',
          });
          return;
        }
        response.setHeader('Cache-Control', 'no-store');
        const token = request.headers.cookie
          ?.split(';')
          .map((s) => s.trim())
          .find((s) => s.startsWith('center_session='))
          ?.slice('center_session='.length);
        const cookie = (value: string, age: number) =>
          response.setHeader(
            'Set-Cookie',
            `center_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${request.secure ? '; Secure' : ''}`,
          );
        const origin: string | undefined = request.headers.origin;
        const isWrite: boolean = !['GET', 'HEAD', 'OPTIONS'].includes(
          request.method,
        );
        if (
          isWrite &&
          (origin || request.headers['sec-fetch-site'] === 'cross-site')
        ) {
          try {
            if (
              !origin ||
              new URL(origin).origin !==
                `${request.protocol}://${request.headers.host}`
            ) {
              response.status(403).send('已拒绝跨站写入');
              return;
            }
          } catch {
            response.status(403).send('请求来源无效');
            return;
          }
        }
        if (request.path === '/login' && request.method === 'GET') {
          response.type('html').send(centerLoginPage);
          return;
        }
        if (request.path === '/api/center/login' && request.method === 'POST') {
          if (
            !origin ||
            typeof request.body?.username !== 'string' ||
            typeof request.body?.password !== 'string'
          ) {
            response.status(400).json({ message: '登录请求无效' });
            return;
          }
          const fresh = await sessions.login(
            request.body.username,
            request.body.password,
          );
          if (!fresh) {
            response.status(401).json({ message: '用户名或密码错误' });
            return;
          }
          sessions.logout(token);
          cookie(fresh, 8 * 3600);
          response.json({ ok: true });
          return;
        }
        if (
          request.path === '/api/center/logout' &&
          request.method === 'POST'
        ) {
          if (!origin) {
            response.status(403).end();
            return;
          }
          sessions.logout(token);
          cookie('', 0);
          response.json({ ok: true });
          return;
        }
        const session = await sessions.resolve(token);
        // Keep explicit CLI Basic access, never Chrome's cached Basic identity.
        const credentials =
          !request.headers['sec-fetch-mode'] && !token
            ? readBasicCredentials(request.headers.authorization)
            : undefined;
        const username =
          session?.username ||
          (credentials &&
          (await authenticateCenterAsync(
            credentials.username,
            credentials.password,
            accessPassword,
          ))
            ? credentials.username
            : undefined);
        if (!username) {
          if (request.method === 'GET' && !request.path.startsWith('/api/'))
            response.redirect('/login');
          else response.status(401).json({ message: '请重新登录' });
          return;
        }
        const binding = request.headers['x-center-session'];
        if (
          session &&
          ((binding && binding !== session.sessionId) ||
            (isWrite && (!origin || binding !== session.sessionId)))
        ) {
          response
            .status(409)
            .json({ message: '登录身份已变化，请刷新页面后重试' });
          return;
        }
        if (request.path === '/api/center/me') {
          response.setHeader('Cache-Control', 'no-store');
          response.json({
            username,
            sessionId: session?.sessionId,
            doris: personalDorisStatus(username),
          });
          return;
        }
        response.setHeader('Cache-Control', 'no-store');
        if (
          request.path.startsWith('/api/growth-decision') &&
          !(
            request.method === 'GET' &&
            request.path === '/api/growth-decision/analysis/sharing'
          ) &&
          !isMellowSharedRoute(request.method, request.path, username) &&
          request.path !==
            '/api/growth-decision/adjustments/authorization-link' &&
          request.path !==
            '/api/growth-decision/adjustments/authorization-status' &&
          !(
            request.method === 'GET' &&
            [
              '/api/growth-decision/dashboard',
              '/api/growth-decision/meta-operations/weekly',
            ].includes(request.path)
          ) &&
          !personalDorisStatus(username).configured
        ) {
          response.status(403).json({
            message: '请先配置本人的 Doris Key；不会使用他人的凭据或缓存',
          });
          return;
        }
        runPersonalData(username, next);
      } catch (error) {
        next(error);
      }
    },
  );

  app.useStaticAssets(clientDirectory);
  app.setBaseViewsDir(clientDirectory);
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);
  app.enableShutdownHooks();

  await app.listen(port, host);
  try {
    const secureServer = await startOptionalHttps(
      httpsConfig,
      host,
      app.getHttpAdapter().getInstance(),
    );
    if (secureServer && httpsConfig) {
      app.getHttpServer().once('close', () => secureServer.close());
      logger.log(`安全入口已启动: https://${host}:${httpsConfig.port}`);
    }
  } catch (error) {
    await app.close();
    throw error;
  }
  logger.log(`AI 增长决策中心已启动: http://${host}:${port}`);
}

void bootstrap();
