#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../../', import.meta.url));
const target = process.argv[2] && resolve(process.argv[2]);
if (
  !target ||
  !existsSync(join(target, 'lib/meta.ts')) ||
  !existsSync(join(target, 'package.json'))
) {
  console.error(
    '用法：node scripts/company-mac/install-adjustment-adapter.mjs 原上传工具仓库绝对路径',
  );
  process.exit(1);
}
const pairs = [
  [
    'integrations/meta-uploader/growth-adjustments-route.ts',
    'app/api/meta/growth-adjustments/route.ts',
  ],
  ['shared/meta-adjustment.ts', 'lib/growth-adjustment-contract.ts'],
];
for (const [from, to] of pairs) {
  const destination = join(target, to);
  if (
    existsSync(destination) &&
    readFileSync(destination, 'utf8') !==
      readFileSync(join(source, from), 'utf8')
  ) {
    copyFileSync(destination, `${destination}.${Date.now()}.bak`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(source, from), destination);
}
console.log(
  '已安装两个新增适配文件。未修改原 API、key 或上传任务。请在原工具仓库构建并按原方式重启；未执行广告操作。',
);
