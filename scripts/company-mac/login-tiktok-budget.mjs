// Run as the same macOS user as the decision center launch agent.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = fileURLToPath(new URL('../../runtime/tiktok/', import.meta.url));
const profile = join(folder, 'budget-chrome');
const config = join(folder, 'web-budget-accounts.json');
const args = process.argv.slice(2);
let existing = [];
try {
  existing = JSON.parse(readFileSync(config, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const ids = [...new Set([...existing, ...args])];
if (
  !ids.length ||
  ids.some((id) => typeof id !== 'string' || !/^\d{1,24}$/.test(id))
)
  throw new Error(
    '首次使用时请在命令后填写月结广告账户 ID，可用空格分隔多个 ID。',
  );
mkdirSync(profile, { recursive: true, mode: 0o700 });
console.log(
  '请在新开的专用 Chrome 中登录个人 TikTok 账号。看到对应账户的预算卡片后，在该专用窗口按 Command+Q 退出，以便后台使用登录状态。',
);
const run = spawnSync(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    'https://ads.tiktok.com/i18n/account/payment?aadvid=' + (args[0] || ids[0]),
  ],
  { stdio: 'ignore' },
);
if (run.error || run.status !== 0)
  throw new Error(
    'Chrome 启动失败，请确认已安装 Google Chrome 并关闭此前的专用窗口。',
  );
const temp = join(dirname(config), randomUUID() + '.tmp');
writeFileSync(temp, JSON.stringify(ids), { mode: 0o600 });
renameSync(temp, config);
console.log(
  '已配置 ' +
    ids.length +
    ' 个网页预算账户。请回到账户余额页点击「刷新余额」。',
);
