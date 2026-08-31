import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const clientDirectory = join(process.cwd(), 'dist', 'client');
const nestedIndex = join(clientDirectory, 'client', 'index.html');
const serverIndex = join(clientDirectory, 'index.html');

if (!existsSync(nestedIndex)) {
  throw new Error(`standalone 前端入口不存在：${nestedIndex}`);
}

renameSync(nestedIndex, serverIndex);
process.stdout.write(`公司 Mac 前端入口已生成：${serverIndex}\n`);
