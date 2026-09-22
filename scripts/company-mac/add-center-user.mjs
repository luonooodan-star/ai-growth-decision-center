#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const username = process.argv[2];
if (
  !/^[a-zA-Z0-9_-]{1,40}$/.test(username || '') ||
  ['growth', '__proto__', 'constructor', 'prototype'].includes(username)
)
  throw new Error(
    '请提供独立用户名（字母、数字、下划线或横线），不能使用保留名称',
  );
const root = fileURLToPath(new URL('../../', import.meta.url));
const file = join(root, 'runtime/center-users.json');
const users = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
if (Object.hasOwn(users, username)) throw new Error('用户已存在，未覆盖密码');
async function passwordPrompt() {
  if (process.env.GROWTH_NEW_USER_PASSWORD)
    return process.env.GROWTH_NEW_USER_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('请在终端运行并输入密码');
  process.stdout.write('请输入新用户密码（不回显）：');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    const done = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') {
          done();
          reject(new Error('已取消'));
          return;
        }
        if (char === '\r' || char === '\n') {
          done();
          resolve(password);
          return;
        }
        if (char === '\u007f') password = password.slice(0, -1);
        else password += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
const password = await passwordPrompt();
if (password.length < 12 || password.length > 1024)
  throw new Error('密码长度需为 12～1024 位');
const salt = randomBytes(16).toString('hex');
users[username] = {
  salt,
  hash: scryptSync(password, salt, 64).toString('hex'),
};
mkdirSync(join(root, 'runtime'), { recursive: true });
const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
writeFileSync(temporary, JSON.stringify(users, null, 2), {
  mode: 0o600,
  flag: 'wx',
});
renameSync(temporary, file);
chmodSync(file, 0o600);
console.log(
  `已创建用户 ${username}，仅保存加盐哈希。未绑定任何 Meta 身份，未执行广告操作。`,
);
