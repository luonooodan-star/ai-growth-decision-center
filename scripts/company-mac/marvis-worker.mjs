#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';

const ACCESS_KEYCHAIN_SERVICE = 'ai-growth-decision-center-access';
const MARVIS_KEYCHAIN_SERVICE = 'ai-growth-decision-center-mavis-mcp';
const MCP_URL = process.env.AI_GROWTH_MCP_URL ||
  'http://127.0.0.1:8081/mcp/growth-decision';
const DEFAULT_WORKER_ID = 'marvis-company-mac';

function secret(service) {
  return execFileSync(
    'security',
    [
      'find-generic-password',
      '-a',
      userInfo().username,
      '-s',
      service,
      '-w',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
}

async function callTool(name, args) {
  let accessPassword;
  let marvisToken;
  try {
    accessPassword = secret(ACCESS_KEYCHAIN_SERVICE);
    marvisToken = secret(MARVIS_KEYCHAIN_SERVICE);
  } catch {
    throw new Error('Keychain 凭据缺失，请先运行公司 Mac setup.sh');
  }

  const basic = Buffer.from(`growth:${accessPassword}`).toString('base64');
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
      'X-Marvis-Token': marvisToken,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${Date.now()}-${name}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`决策中心 MCP 请求失败（HTTP ${response.status}）：${text}`);
  }
  const payload = JSON.parse(text);
  if (payload.error) throw new Error(payload.error.message || 'MCP 工具调用失败');
  return payload.result?.structuredContent;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const command = process.argv[2] || 'claim';
  if (command === 'claim') {
    const workerId = process.argv[3] || DEFAULT_WORKER_ID;
    const claimed = await callTool('claim_analysis_job', { workerId });
    if (!claimed?.job) {
      printJson({ job: null });
      return;
    }
    const context = await callTool('get_anomaly_context', {
      jobId: claimed.job.id,
    });
    printJson(context);
    return;
  }

  if (command === 'submit') {
    const jobId = process.argv[3];
    const analysisPath = process.argv[4];
    const workerId = process.argv[5] || DEFAULT_WORKER_ID;
    if (!jobId || !analysisPath) {
      throw new Error('用法：marvis-worker.mjs submit <jobId> <analysis.json> [workerId]');
    }
    const analysis = JSON.parse(await readFile(analysisPath, 'utf8'));
    printJson(await callTool('submit_anomaly_analysis', {
      jobId,
      workerId,
      model: 'Marvis Growth Analyst',
      analysis,
    }));
    return;
  }

  if (command === 'fail') {
    const jobId = process.argv[3];
    const error = process.argv.slice(4).join(' ').trim();
    if (!jobId || !error) {
      throw new Error('用法：marvis-worker.mjs fail <jobId> <错误原因>');
    }
    printJson(await callTool('fail_analysis_job', {
      jobId,
      workerId: DEFAULT_WORKER_ID,
      error,
    }));
    return;
  }

  throw new Error('支持的命令：claim、submit、fail');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

