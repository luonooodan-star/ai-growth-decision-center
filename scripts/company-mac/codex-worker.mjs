#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(dirname(scriptDirectory));
const runtimeDirectory = join(projectDirectory, '.runtime');
const requestDirectory = join(runtimeDirectory, 'codex-requests');
const responseDirectory = join(runtimeDirectory, 'codex-responses');
const responseTimeoutMs = 130_000;

async function callBridge(command, args) {
  const requestId = randomUUID();
  const requestPath = join(requestDirectory, `${requestId}.json`);
  const temporaryPath = join(requestDirectory, `${requestId}.tmp`);
  const responsePath = join(responseDirectory, `${requestId}.json`);
  await mkdir(requestDirectory, { recursive: true, mode: 0o700 });
  await mkdir(responseDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    temporaryPath,
    JSON.stringify({ requestId, command, args }),
    { encoding: 'utf8', mode: 0o600 },
  );
  await rename(temporaryPath, requestPath);
  const deadline = Date.now() + responseTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const body = await readFile(responsePath, 'utf8');
      await unlink(responsePath).catch(() => undefined);
      return JSON.parse(body);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await wait(100);
  }
  await unlink(requestPath).catch(() => undefined);
  throw new Error(
    'Codex 本机凭据桥响应超时，请执行 configure-codex-worker.sh status',
  );
}

const command = process.argv[2] || 'claim';
const args = process.argv.slice(3);

try {
  await chmod(runtimeDirectory, 0o700).catch(() => undefined);
  const result = await callBridge(command, args);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(`${result.stderr.trim()}\n`);
  if (!result.ok) process.exitCode = result.exitCode || 1;
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
