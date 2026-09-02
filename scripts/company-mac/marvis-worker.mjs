#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';

const ACCESS_KEYCHAIN_SERVICE = 'ai-growth-decision-center-access';
const MARVIS_KEYCHAIN_SERVICE = 'ai-growth-decision-center-mavis-mcp';
const REMOTE_URL_SERVICE = 'ai-growth-decision-center-marvis-remote-url';
const REMOTE_USER_SERVICE = 'ai-growth-decision-center-marvis-remote-user';
const REMOTE_PASSWORD_SERVICE =
  'ai-growth-decision-center-marvis-remote-password';
const REMOTE_TOKEN_SERVICE = 'ai-growth-decision-center-marvis-remote-token';
const DEFAULT_WORKER_ID = 'codex-growth-analyst';

function secret(service) {
  return execFileSync(
    'security',
    ['find-generic-password', '-a', userInfo().username, '-s', service, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
}

function optionalSecret(service) {
  try {
    return secret(service);
  } catch {
    return '';
  }
}

function connectionConfig() {
  const remoteUrl = optionalSecret(REMOTE_URL_SERVICE);
  if (remoteUrl) {
    const username = optionalSecret(REMOTE_USER_SERVICE) || 'growth';
    const password = optionalSecret(REMOTE_PASSWORD_SERVICE);
    const token = optionalSecret(REMOTE_TOKEN_SERVICE);
    if (!password || !token) {
      throw new Error(
        '远程 Codex 凭据不完整，请运行 configure-marvis-remote.sh setup',
      );
    }
    return {
      url: process.env.AI_GROWTH_MCP_URL || remoteUrl,
      username,
      password,
      token,
      mode: 'remote',
    };
  }

  const password = optionalSecret(ACCESS_KEYCHAIN_SERVICE);
  const token = optionalSecret(MARVIS_KEYCHAIN_SERVICE);
  if (!password || !token) {
    throw new Error(
      '未找到本机或远程 Keychain 凭据，请运行 configure-marvis-remote.sh setup',
    );
  }
  return {
    url:
      process.env.AI_GROWTH_MCP_URL ||
      'http://127.0.0.1:8081/mcp/growth-decision',
    username: 'growth',
    password,
    token,
    mode: 'local',
  };
}

async function callMcp(method, params = undefined) {
  const connection = connectionConfig();
  const basic = Buffer.from(
    `${connection.username}:${connection.password}`,
  ).toString('base64');
  const response = await fetch(connection.url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
      'X-Marvis-Token': connection.token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${Date.now()}-${method}`,
      method,
      ...(params ? { params } : {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `决策中心 MCP 请求失败（HTTP ${response.status}）：${text}`,
    );
  }
  const payload = JSON.parse(text);
  if (payload.error)
    throw new Error(payload.error.message || 'MCP 工具调用失败');
  return payload.result;
}

async function callTool(name, args) {
  const result = await callMcp('tools/call', { name, arguments: args });
  return result?.structuredContent;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function validateBatchIds(context, analyses) {
  if (!Array.isArray(analyses)) {
    throw new Error('批量分析文件必须是 JSON 数组');
  }
  const expectedIds = new Set(
    (context?.job?.judgmentIds || [context?.job?.judgmentId])
      .filter(Boolean)
      .map((id) => String(id).trim()),
  );
  const receivedIds = analyses.map((item) =>
    String(item?.judgmentId || '').trim(),
  );
  const receivedSet = new Set(receivedIds);
  const missingIds = [...expectedIds].filter((id) => !receivedSet.has(id));
  const unknownIds = [...receivedSet].filter((id) => !expectedIds.has(id));
  const duplicateIds = [...receivedSet].filter(
    (id) => receivedIds.filter((candidate) => candidate === id).length > 1,
  );
  if (
    expectedIds.size !== receivedIds.length ||
    missingIds.length > 0 ||
    unknownIds.length > 0 ||
    duplicateIds.length > 0
  ) {
    throw new Error(
      `批量分析文件与任务不一致：期望 ${expectedIds.size} 条，收到 ${receivedIds.length} 条；` +
        `缺失=${JSON.stringify(missingIds)}；未知=${JSON.stringify(unknownIds)}；` +
        `重复=${JSON.stringify(duplicateIds)}`,
    );
  }
  analyses.forEach((item) => {
    item.judgmentId = String(item.judgmentId).trim();
  });
}

async function main() {
  const command = process.argv[2] || 'claim';
  if (command === 'check') {
    const connection = connectionConfig();
    const result = await callMcp('tools/list');
    printJson({
      ok: true,
      mode: connection.mode,
      mcpUrl: connection.url,
      tools: (result?.tools || []).map((tool) => tool.name),
    });
    return;
  }

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
      throw new Error(
        '用法：marvis-worker.mjs submit <jobId> <analysis.json> [workerId]',
      );
    }
    const analysis = JSON.parse(await readFile(analysisPath, 'utf8'));
    printJson(
      await callTool('submit_anomaly_analysis', {
        jobId,
        workerId,
        model: 'gpt-5.6-terra',
        analysis,
      }),
    );
    return;
  }

  if (command === 'submit-batch') {
    const jobId = process.argv[3];
    const analysesPath = process.argv[4];
    const workerId = process.argv[5] || DEFAULT_WORKER_ID;
    if (!jobId || !analysesPath) {
      throw new Error(
        '用法：marvis-worker.mjs submit-batch <jobId> <analyses.json> [workerId]',
      );
    }
    const analyses = JSON.parse(await readFile(analysesPath, 'utf8'));
    const context = await callTool('get_anomaly_context', { jobId });
    validateBatchIds(context, analyses);
    printJson(
      await callTool('submit_batch_analysis', {
        jobId,
        workerId,
        model: 'gpt-5.6-terra',
        analyses,
      }),
    );
    return;
  }

  if (command === 'fail') {
    const jobId = process.argv[3];
    const error = process.argv.slice(4).join(' ').trim();
    if (!jobId || !error) {
      throw new Error('用法：marvis-worker.mjs fail <jobId> <错误原因>');
    }
    printJson(
      await callTool('fail_analysis_job', {
        jobId,
        workerId: DEFAULT_WORKER_ID,
        error,
      }),
    );
    return;
  }

  throw new Error('支持的命令：check、claim、submit、submit-batch、fail');
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
