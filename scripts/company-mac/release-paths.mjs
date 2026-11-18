import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function releaseDirectory(root, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{12}-[0-9]{13}$/.test(id))
    throw new Error('发布版本标识无效');
  return join(resolve(root), 'runtime', 'releases', id);
}
export function readRelease(root) {
  const file = join(root, 'runtime', 'active-release.json');
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value === null) return null;
  releaseDirectory(root, value.id);
  return value;
}
export function writeRelease(root, value) {
  if (value !== null) releaseDirectory(root, value.id);
  const file = join(root, 'runtime', 'active-release.json');
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
}
export function verifyRelease(directory) {
  for (const path of [
    'dist/server/standalone.js',
    'dist/client/index.html',
    'node_modules/@nestjs/core/package.json',
  ]) {
    if (!existsSync(join(directory, path)))
      throw new Error(`发布文件缺失：${path}`);
  }
  const html = readFileSync(join(directory, 'dist/client/index.html'), 'utf8');
  const assets = [
    ...html.matchAll(/(?:src|href)="\/assets\/([^"?#]+)(?:[?#][^"]*)?"/g),
  ];
  if (!assets.some(([, name]) => name.endsWith('.js')))
    throw new Error('前端入口缺少构建脚本');
  for (const [, asset] of assets) {
    if (
      asset.includes('..') ||
      !existsSync(join(directory, 'dist/client/assets', asset))
    )
      throw new Error('前端静态资源不完整');
  }
  // Older releases have a single classic script, while module builds also
  // need the files loaded after a user opens a different page.
  if (/<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc=)[^>]*>/.test(html)) {
    const client = join(directory, 'dist/client');
    const manifest = JSON.parse(
      readFileSync(join(client, '.vite/manifest.json'), 'utf8'),
    );
    const entry = manifest['client/index.html'];
    if (
      !entry?.isEntry ||
      !assets.some(([, name]) => 'assets/' + name === entry.file)
    )
      throw new Error('前端构建清单与入口不匹配');
    for (const chunk of Object.values(manifest)) {
      for (const file of [
        chunk.file,
        ...(chunk.css || []),
        ...(chunk.assets || []),
      ]) {
        if (
          !/^assets\/[\w-][\w.-]*$/.test(file) ||
          !existsSync(join(client, file))
        )
          throw new Error(`前端构建清单中的资源缺失或路径无效：${file}`);
      }
      for (const key of [
        ...(chunk.imports || []),
        ...(chunk.dynamicImports || []),
      ]) {
        if (!Object.hasOwn(manifest, key))
          throw new Error('前端构建清单缺少页面依赖');
      }
    }
  }
}
export async function activateRelease(root, next, { restart, healthy }) {
  verifyRelease(releaseDirectory(root, next.id));
  const previous = readRelease(root);
  writeFileSync(
    join(root, 'runtime', 'previous-release.json'),
    JSON.stringify(previous),
    { mode: 0o600 },
  );
  writeRelease(root, next);
  try {
    await restart();
    if (!(await healthy(next.id))) throw new Error('新版本启动健康检查失败');
  } catch (error) {
    writeRelease(root, previous);
    await restart();
    if (!(await healthy(previous?.id || 'legacy')))
      throw new Error(`新版本失败，旧版本恢复也未通过检查：${error.message}`);
    throw new Error(`新版本启动失败，已恢复旧版本：${error.message}`);
  }
  return previous;
}
