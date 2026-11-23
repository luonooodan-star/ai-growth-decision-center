// Read exactly one configured account through the active release's normal collector.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readRelease, releaseDirectory } from './release-paths.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const release = readRelease(root);
const dist = release ? releaseDirectory(root, release.id) : root;
const { collectWebBudgets, webBudgetAccounts } = await import(
  pathToFileURL(
    join(dist, 'dist/server/modules/growth-decision/tiktok-web-budget.js'),
  ).href
);
const folder = join(root, 'runtime/tiktok');
const id = process.argv[2];
if (!(await webBudgetAccounts(folder)).includes(id))
  throw new Error(
    '这个账户尚未配置网页预算采集。请先运行 login-tiktok-budget.mjs 并传入账户 ID。',
  );
const result = (await collectWebBudgets(folder, [id])).get(id);
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
