#!/usr/bin/env node
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const file = join(root, 'runtime/meta-workspace.json');
const [command, ...args] = process.argv.slice(2);
if (!command || command === '--help') {
  console.log(`用法（先运行 npm run build:company）：
  node scripts/company-mac/configure-meta-workspace.mjs check
  node scripts/company-mac/configure-meta-workspace.mjs setup --workspace-origin HTTPS地址 --center-origin HTTPS地址 --cert 证书绝对路径 --key 私钥绝对路径
仅保存非 Meta 凭据配置，覆盖前备份；不会重启服务或操作广告。`);
} else {
  try {
    if (!['setup', 'check'].includes(command))
      throw new Error('仅支持 setup 或 check');
    const require = createRequire(import.meta.url);
    const {
      validateMetaWorkspaceSettings,
      loadMetaWorkspaceSettings,
    } = require(
      join(root, 'dist/server/common/utils/meta-workspace-settings.js'),
    );
    const { readOptionalHttps } = require(
      join(root, 'dist/server/common/utils/optional-https.js'),
    );
    if (command === 'check') {
      if (args.length) throw new Error('check 不接受参数');
      const env = { SERVER_PORT: process.env.SERVER_PORT };
      if (!loadMetaWorkspaceSettings(env, root))
        throw new Error('尚未持久化工作区配置，请先运行 setup');
      readOptionalHttps(env);
      console.log(
        '本地配置、证书有效期、主机名及私钥匹配检查通过。未连接远程服务；浏览器信任与登录仍需验收。',
      );
    } else {
      const options = {};
      const allowed = [
        '--workspace-origin',
        '--center-origin',
        '--cert',
        '--key',
      ];
      for (let i = 0; i < args.length; i += 2) {
        if (!allowed.includes(args[i]) || !args[i + 1] || options[args[i]])
          throw new Error('参数缺失、重复或不支持；使用 --help 查看用法');
        options[args[i]] = args[i + 1];
      }
      if (allowed.some((key) => !options[key]))
        throw new Error('需要完整地址及证书路径');
      const center = new URL(options['--center-origin']);
      const settings = validateMetaWorkspaceSettings({
        GROWTH_META_WORKSPACE_ORIGIN: options['--workspace-origin'],
        GROWTH_SECURE_CENTER_ORIGIN: options['--center-origin'],
        GROWTH_HTTPS_PORT: center.port || '443',
        GROWTH_TLS_CERT_PATH: options['--cert'],
        GROWTH_TLS_KEY_PATH: options['--key'],
      });
      readOptionalHttps({ ...settings, SERVER_PORT: process.env.SERVER_PORT });
      mkdirSync(dirname(file), { recursive: true });
      const nonce = randomUUID();
      const temporary = `${file}.${nonce}.tmp`;
      const backup = `${file}.${nonce}.bak`;
      try {
        writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', {
          mode: 0o600,
          flag: 'wx',
        });
        if (existsSync(file)) {
          copyFileSync(file, backup);
          console.log(`原配置已备份：${backup}`);
        }
        renameSync(temporary, file);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
      console.log(
        `已保存：${file}\n下次服务重启生效；本工具未重启服务、未复制 Meta key、未调用广告 API。`,
      );
    }
  } catch (error) {
    // Never print TLS buffers, input values, or a potentially credential-bearing URL.
    const code = error?.code;
    const message = code
      ? `配置检查失败（${code}），请检查构建产物和证书文件。`
      : error instanceof TypeError
        ? '配置格式无效，请检查地址及参数。'
        : error.message;
    console.error(message);
    process.exitCode = 1;
  }
}
