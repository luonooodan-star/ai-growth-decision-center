// Read exactly one specified account through the active release's normal collector.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readRelease, releaseDirectory } from './release-paths.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const release = readRelease(root);
const dist = release ? releaseDirectory(root, release.id) : root;
const { collectWebBudgets } = await import(
  pathToFileURL(
    join(dist, 'dist/server/modules/growth-decision/tiktok-web-budget.js'),
  ).href
);
const folder = join(root, 'runtime/tiktok');
const id = process.argv[2];
if (!id || !/^\d{1,24}$/.test(id)) throw new Error('请传入一个广告账户 ID。');
const visible = process.argv[3] === '--visible';
if (visible)
  console.log(
    '正在用同一专用配置打开 Chrome。如需登录或选账户，请在两分钟内进入目标账户的预算页，保持窗口打开。',
  );
const result = (await collectWebBudgets(folder, [id], visible)).get(id);
if (result?.budget) {
  const { period, total, spent, remaining, currency } = result.budget;
  console.log(
    id +
      ' · ' +
      period +
      '预算 ' +
      total +
      ' · 已花费 ' +
      spent +
      ' · 剩余 ' +
      remaining +
      ' ' +
      currency,
  );
} else {
  console.error(id + ' · ' + (result?.error || '未取得结果'));
  process.exitCode = 1;
}
