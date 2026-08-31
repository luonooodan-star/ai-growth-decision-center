import { execFileSync } from 'node:child_process';

const keychainService = 'ai-growth-decision-center-groq';
const apiKey = execFileSync(
  'security',
  [
    'find-generic-password',
    '-a',
    process.env.USER || '',
    '-s',
    keychainService,
    '-w',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
).trim();

const response = await fetch('https://api.groq.com/openai/v1/models', {
  headers: { Authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`Groq Key 校验失败（HTTP ${response.status}）：${detail}`);
}

const payload = await response.json();
const models = Array.isArray(payload?.data) ? payload.data : [];
const available = models.some(
  (item) => item?.id === 'openai/gpt-oss-120b',
);

if (!available) {
  throw new Error('Groq 连接成功，但当前账号未返回 openai/gpt-oss-120b。');
}

process.stdout.write('Groq 验证成功：openai/gpt-oss-120b 可用。\n');
