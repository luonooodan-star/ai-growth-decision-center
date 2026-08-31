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

const endpoint =
  process.env.GLM_API_URL ||
  'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const model = process.env.GLM_MODEL || 'glm-4.7-flash';
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

let overloaded = false;
for (let attempt = 1; attempt <= 4; attempt += 1) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '只回答 OK' }],
      temperature: 0,
      max_tokens: 8,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (response.ok) {
    process.stdout.write(`GLM 验证成功：${model} 可用。\n`);
    process.exit(0);
  }

  const detail = await response.text();
  overloaded = response.status === 429 && detail.includes('"code":"1305"');
  if (!overloaded) {
    throw new Error(`GLM Key 校验失败（HTTP ${response.status}）：${detail}`);
  }
  if (attempt < 4) {
    const delaySeconds = attempt * 3;
    process.stderr.write(
      `GLM 当前繁忙，${delaySeconds} 秒后进行第 ${attempt + 1} 次校验…\n`,
    );
    await wait(delaySeconds * 1000);
  }
}

if (overloaded) {
  process.stdout.write(
    'GLM Key 已保存，鉴权已到达模型服务；当前模型访问量过大。\n' +
      '服务会正常启动，GLM 繁忙时自动改用产品 Skill。\n',
  );
}
