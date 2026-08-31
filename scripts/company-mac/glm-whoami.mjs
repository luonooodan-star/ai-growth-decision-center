import { execFileSync } from 'node:child_process';

const keychainService = 'ai-growth-decision-center-glm';

const keychainKey = () => {
  try {
    return execFileSync(
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
  } catch {
    return '';
  }
};

const apiKey = process.env.GLM_API_KEY || keychainKey();
if (!apiKey) throw new Error('GLM API Key 未配置。');

const response = await fetch(
  process.env.GLM_API_URL ||
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GLM_MODEL || 'glm-4.7-flash',
      messages: [{ role: 'user', content: '只回答 OK' }],
      temperature: 0,
      max_tokens: 8,
    }),
    signal: AbortSignal.timeout(30_000),
  },
);

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`GLM Key 校验失败（HTTP ${response.status}）：${detail}`);
}

process.stdout.write('GLM 验证成功：glm-4.7-flash 可用。\n');
