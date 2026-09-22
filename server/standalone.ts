import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { __express as hbsExpressEngine } from 'hbs';
import { authenticateCenter } from './common/utils/center-identity';
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
  const clientDirectory: string = join(process.cwd(), 'dist/client');

  if (accessPassword.length < 12) {
    throw new Error('GROWTH_BASIC_AUTH_PASSWORD 至少需要 12 位');
  }

  app.use((request: Request, response: Response, next: NextFunction): void => {
    if (request.path === '/health/live') {
      response.json({ ok: true });
      return;
    }
    const credentials = readBasicCredentials(request.headers.authorization);
    const authenticated: boolean = Boolean(
      credentials &&
      authenticateCenter(
        credentials.username,
        credentials.password,
        accessPassword,
      ),
    );
    if (!authenticated) {
      response.setHeader(
        'WWW-Authenticate',
        'Basic realm="AI Growth Decision Center", charset="UTF-8"',
      );
      response.status(401).send('需要访问授权');
      return;
    }
    const origin: string | undefined = request.headers.origin;
    const isWrite: boolean = !['GET', 'HEAD', 'OPTIONS'].includes(
      request.method,
    );
    if (isWrite && origin) {
      try {
        if (new URL(origin).host !== request.headers.host) {
          response.status(403).send('已拒绝跨站写入');
          return;
        }
      } catch {
        response.status(403).send('请求来源无效');
        return;
      }
    }
    if (request.path === '/api/center/me') {
      response.setHeader('Cache-Control', 'no-store');
      response.json({
        username: credentials!.username,
        doris: personalDorisStatus(credentials!.username),
      });
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    if (
      request.path.startsWith('/api/growth-decision') &&
      request.path !== '/api/growth-decision/adjustments/authorization-link' &&
      request.path !==
        '/api/growth-decision/adjustments/authorization-status' &&
      !(
        request.method === 'GET' &&
        [
          '/api/growth-decision/dashboard',
          '/api/growth-decision/meta-operations/weekly',
        ].includes(request.path)
      ) &&
      !personalDorisStatus(credentials!.username).configured
    ) {
      response.status(403).json({
        message: '请先配置本人的 Doris Key；不会使用他人的凭据或缓存',
      });
      return;
    }
    runPersonalData(credentials!.username, next);
  });

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
