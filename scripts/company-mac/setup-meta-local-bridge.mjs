#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = process.argv[2] && resolve(process.argv[2]);
const workspaceOrigin = process.argv[3] || 'https://192.168.3.173:3001';
try {
  if (!target || !existsSync(join(target, 'lib/meta.ts')))
    throw new Error('请传入原广告工具仓库目录');
  const url = new URL(workspaceOrigin);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('原广告工具地址必须是 HTTPS origin');
  const viteFile = join(target, 'vite.config.ts');
  const current = readFileSync(viteFile, 'utf8');
  if (!current.includes('plugins: [') || !current.includes('vinext'))
    throw new Error('原工具启动配置不匹配，未修改；需要检查实际启动方式');
  const runtime = join(root, 'runtime');
  mkdirSync(runtime, { recursive: true });
  const file = join(runtime, 'meta-local-bridge.json');
  if (
    current.includes('growthLocalBridge(') &&
    !current.includes(JSON.stringify(file))
  )
    throw new Error('已有本机桥指向其他目录，请先核对');
  let config = {
    origin: 'http://127.0.0.1:18761',
    secret: randomBytes(32).toString('hex'),
    workspaceOrigin: url.origin,
  };
  if (existsSync(file)) {
    const old = JSON.parse(readFileSync(file, 'utf8'));
    if (old.origin !== config.origin || !/^[a-f0-9]{64}$/.test(old.secret))
      throw new Error('已有本机桥配置不匹配，未覆盖');
    config = { ...config, secret: old.secret };
  }
  const installed = spawnSync(
    process.execPath,
    [join(root, 'scripts/company-mac/install-adjustment-adapter.mjs'), target],
    { stdio: 'inherit' },
  );
  if (installed.status !== 0) throw new Error('适配接口安装失败');
  writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
  const pluginDir = join(target, '.growth-local');
  mkdirSync(pluginDir, { recursive: true });
  copyFileSync(
    join(root, 'integrations/meta-uploader/growth-local-bridge.mjs'),
    join(pluginDir, 'bridge.mjs'),
  );
  const ignoreFile = join(target, '.gitignore');
  const ignores = existsSync(ignoreFile)
    ? readFileSync(ignoreFile, 'utf8')
    : '';
  if (!ignores.includes('/.growth-local/'))
    writeFileSync(ignoreFile, `${ignores}\n/.growth-local/\n`);
  let next = current;
  if (!current.includes('growthLocalBridge(')) {
    next =
      `import { growthLocalBridge } from './.growth-local/bridge.mjs';\n${current}`.replace(
        'plugins: [',
        `plugins: [\n      growthLocalBridge(${JSON.stringify(file)}),`,
      );
    copyFileSync(viteFile, `${viteFile}.${Date.now()}.bak`);
    writeFileSync(viteFile, next);
  }
  console.log(
    '本机桥安装完成。仅支持原工具的 Vite/vinext dev 启动方式；build 不启动本机桥。',
  );
  console.log(
    '请按原方式重启原工具，再打开原工具 /growth-center-link 授权当前登录。决策中心仍使用 8081。',
  );
  console.log(
    '未读取或更换 Meta key，未重启服务，未执行广告操作。独立桥凭据只保存于权限 0600 的 runtime 文件。',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
