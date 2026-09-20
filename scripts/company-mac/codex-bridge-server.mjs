#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(dirname(scriptDirectory));
const runtimeDirectory = join(projectDirectory, '.runtime');
const requestDirectory = join(runtimeDirectory, 'codex-requests');
const responseDirectory = join(runtimeDirectory, 'codex-responses');
const readyPath = join(runtimeDirectory, 'codex-bridge.ready');
const workerScript = join(scriptDirectory, 'marvis-worker.mjs');
const allowedCommands = new Set([
  'meta-plan',
  'claim-weekly',
  'submit-weekly',
  'fail-weekly',
  'import-meta',
  'check',
  'claim',
  'submit',
  'submit-batch',
  'fail',
]);
let processing = false;

function isSafeIdentifier(value) {
  return /^[a-zA-Z0-9._-]{1,160}$/u.test(String(value || ''));
}

function validateRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('请求格式无效');
  }
  const requestId = String(payload.requestId || '');
  const command = String(payload.command || '');
  const args = Array.isArray(payload.args)
    ? payload.args.map((value) => String(value))
    : [];
  if (!isSafeIdentifier(requestId) || !allowedCommands.has(command)) {
    throw new Error('请求标识或命令无效');
  }
  if (
    (command === 'check' || command === 'claim-weekly') &&
    args.length !== 0
  ) {
    throw new Error('check 命令不接受参数');
  }
  if (command === 'claim') {
    if (args.length > 1 || (args[0] && !isSafeIdentifier(args[0]))) {
      throw new Error('claim 参数无效');
    }
  }
  if (command === 'meta-plan' && (args.length > 1 || (args[0] && !/^\d{1,8}$/.test(args[0])))) {
    throw new Error('meta-plan offset 无效');
  }
  if (
    ['import-meta', 'submit-weekly', 'fail-weekly'].includes(command) &&
    (args.length !== 1 ||
      !/^\/private\/tmp\/codex-growth-[a-zA-Z0-9_-]+\.json$/.test(args[0]))
  ) {
    throw new Error('Meta 导入文件路径无效');
  }
  if (command === 'submit' || command === 'submit-batch') {
    if (
      args.length < 2 ||
      args.length > 3 ||
      !isSafeIdentifier(args[0]) ||
      !args[1].startsWith('/private/tmp/codex-growth-') ||
      !args[1].endsWith('.json') ||
      (args[2] && !isSafeIdentifier(args[2]))
    ) {
      throw new Error('提交参数无效');
    }
  }
  if (command === 'fail') {
    const errorMessage = args.slice(1).join(' ');
    if (
      args.length < 2 ||
      !isSafeIdentifier(args[0]) ||
      errorMessage.length > 1000
    ) {
      throw new Error('失败回写参数无效');
    }
  }
  return { requestId, command, args };
}

function runWorker(command, args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [workerScript, command, ...args],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120_000,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          exitCode:
            typeof error?.code === 'number' ? error.code : error ? 1 : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

async function writeResponse(requestId, result) {
  const responsePath = join(responseDirectory, `${requestId}.json`);
  const temporaryPath = join(responseDirectory, `${requestId}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(result), {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, responsePath);
}

async function processRequests() {
  if (processing) return;
  processing = true;
  try {
    const files = (await readdir(requestDirectory))
      .filter((file) => file.endsWith('.json'))
      .sort();
    for (const file of files) {
      const requestPath = join(requestDirectory, file);
      let requestId = file.slice(0, -5);
      try {
        const request = validateRequest(
          JSON.parse(await readFile(requestPath, 'utf8')),
        );
        requestId = request.requestId;
        const result = await runWorker(request.command, request.args);
        await writeResponse(requestId, result);
      } catch (error) {
        await writeResponse(requestId, {
          ok: false,
          exitCode: 1,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await rm(requestPath, { force: true });
      }
    }
  } finally {
    processing = false;
  }
}

await mkdir(requestDirectory, { recursive: true, mode: 0o700 });
await mkdir(responseDirectory, { recursive: true, mode: 0o700 });
await chmod(runtimeDirectory, 0o700);
await chmod(requestDirectory, 0o700);
await chmod(responseDirectory, 0o700);
await writeFile(readyPath, `${process.pid}\n`, { mode: 0o600 });

const timer = setInterval(() => void processRequests(), 100);
process.stdout.write(`Codex Keychain file bridge ready: ${runtimeDirectory}\n`);

async function shutdown() {
  clearInterval(timer);
  await rm(readyPath, { force: true });
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
