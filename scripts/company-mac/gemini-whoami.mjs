import { execFileSync } from 'node:child_process';

const keychainService = 'ai-growth-decision-center-gemini';

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

const apiKey = process.env.GEMINI_API_KEY || keychainKey();
if (!apiKey) throw new Error('Gemini API Key 未配置。');

const model = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const endpoint =
  process.env.GEMINI_API_URL ||
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'x-goog-api-key': apiKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: '只回答 OK' }] }],
    generationConfig: { maxOutputTokens: 32 },
  }),
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  const detail = await response.text();
  if (response.status === 429) {
    throw new Error(
      `Gemini 免费额度或速率已受限（HTTP 429）：${detail}`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Gemini Key 无效、API 未开启或当前网络不允许访问（HTTP ${response.status}）：${detail}`,
    );
  }
  throw new Error(
    `Gemini Key 校验失败（HTTP ${response.status}）：${detail}`,
  );
}

const payload = await response.json();
const text = payload.candidates?.[0]?.content?.parts
  ?.map((part) => part.text || '')
  .join('');
if (!text) throw new Error('Gemini 连接成功，但模型未返回文本。');

process.stdout.write(`Gemini 验证成功：${model} 可用。\n`);
