#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const MCP_URL = process.env.DORIS_MCP_URL || 'http://192.168.3.102:8766/mcp';
const KEYCHAIN_SERVICE = 'ai-growth-doris-superset-mcp';

function keychainToken() {
  try {
    return execFileSync(
      'security',
      [
        'find-generic-password',
        '-a',
        process.env.USER || '',
        '-s',
        KEYCHAIN_SERVICE,
        '-w',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return '';
  }
}

const token = process.env.DORIS_SUPERSET_MCP_TOKEN || keychainToken();
if (!token) {
  throw new Error('Doris MCP Key 未配置，请先运行 setup.sh。');
}

function parseResponse(raw, contentType) {
  if (contentType.includes('text/event-stream')) {
    const dataLine = raw
      .split(/\r?\n/u)
      .find((line) => line.startsWith('data:'));
    if (!dataLine) throw new Error('MCP 返回了空的 SSE 响应。');
    return JSON.parse(dataLine.slice(5).trim());
  }
  return JSON.parse(raw);
}

async function post(body, sessionId = '') {
  const headers = {
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Doris MCP HTTP ${response.status}: ${await response.text()}`);
  }
  const raw = await response.text();
  const payload = raw ? parseResponse(raw, response.headers.get('content-type') || '') : null;
  return {
    payload,
    sessionId: response.headers.get('mcp-session-id') || sessionId,
  };
}

const initialized = await post({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'ai-growth-decision-center', version: '1.0.0' },
  },
});

if (initialized.payload?.error) {
  throw new Error(`MCP initialize 失败: ${JSON.stringify(initialized.payload.error)}`);
}

await post(
  { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  initialized.sessionId,
);

const whoami = await post(
  {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'whoami', arguments: {} },
  },
  initialized.sessionId,
);

if (whoami.payload?.error) {
  throw new Error(`Doris whoami 失败: ${JSON.stringify(whoami.payload.error)}`);
}

process.stdout.write(`${JSON.stringify({ ok: true, result: whoami.payload?.result }, null, 2)}\n`);
