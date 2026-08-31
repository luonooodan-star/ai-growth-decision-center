import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { __express as hbsExpressEngine } from 'hbs';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

import { StandaloneAppModule } from './standalone-app.module';

const BASIC_AUTH_USER = 'growth';

function secretsMatch(left: string, right: string): boolean {
  const leftBuffer: Buffer = Buffer.from(left);
  const rightBuffer: Buffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

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
      secretsMatch(credentials.username, BASIC_AUTH_USER) &&
      secretsMatch(credentials.password, accessPassword),
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
    next();
  });

  app.useStaticAssets(clientDirectory);
  app.setBaseViewsDir(clientDirectory);
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);
  app.enableShutdownHooks();

  await app.listen(port, host);
  logger.log(`AI 增长决策中心已启动: http://${host}:${port}`);
}

void bootstrap();
