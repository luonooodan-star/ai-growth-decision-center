import { execFileSync } from 'node:child_process';
import { mkdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activateRelease,
  releaseDirectory,
  verifyRelease,
} from './release-paths.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.argv.slice(2).some((arg) => arg !== '--build-only'))
  throw new Error('仅支持 --build-only；默认验证后切换发布');
const runtime = join(root, 'runtime');
mkdirSync(runtime, { recursive: true, mode: 0o700 });
const lock = join(runtime, 'deploy.lock');
try {
  mkdirSync(lock);
} catch {
  throw new Error(
    '已有部署锁 runtime/deploy.lock。确认没有更新任务运行后，异常退出遗留的空锁目录需人工移除。',
  );
}
const command = (bin, args, cwd = root) =>
  execFileSync(bin, args, {
    cwd,
    stdio: 'inherit',
    // Candidate tests/builds must not inherit live data paths or API credentials.
    env:
      cwd === root
        ? process.env
        : Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) =>
                !/^(GROWTH_|DORIS_|SUPERSET_|MAVIS_|META_|DATABASE_|LAN_HTTPS$|NODE_ENV$)/.test(
                  key,
                ),
            ),
          ),
  });
try {
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=normal'],
    { cwd: root, encoding: 'utf8' },
  );
  if (dirty.trim()) throw new Error('存在未提交修改，停止部署');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const id = `${commit.slice(0, 12)}-${Date.now()}`;
  const release = releaseDirectory(root, id);
  mkdirSync(release, { recursive: true, mode: 0o700 });
  const archive = join(release, 'source.tar');
  command('git', ['archive', '--format=tar', '--output', archive, 'HEAD']);
  command('tar', ['-xf', archive, '-C', release]);
  unlinkSync(archive);
  console.log(`独立构建 ${id}；当前服务与 runtime 数据不变`);
  // Isolated dependencies; skip app hooks that mutate git or contact the cloud.
  command(
    'nice',
    ['-n', '10', 'npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    release,
  );
  command('nice', ['-n', '10', 'npm', 'run', 'type:check'], release);
  command('nice', ['-n', '10', 'npm', 'test', '--', '--runInBand'], release);
  command('nice', ['-n', '10', 'npm', 'run', 'test:company-release'], release);
  command('nice', ['-n', '10', 'npm', 'run', 'build:company'], release);
  verifyRelease(release);
  const next = { id, commit, builtAt: new Date().toISOString() };
  writeFileSync(join(release, 'release.json'), JSON.stringify(next), {
    mode: 0o600,
  });
  if (process.argv.includes('--build-only')) {
    console.log(`独立构建与测试通过：${id}；未切换版本、未重启服务。`);
  } else {
    const restart = async () =>
      command('launchctl', [
        'kickstart',
        '-k',
        `gui/${process.getuid()}/com.luonooodan.ai-growth-decision-center`,
      ]);
    const healthy = async (expected) => {
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch('http://127.0.0.1:8081/health/live', {
            signal: AbortSignal.timeout(1500),
          });
          const data = await res.json();
          if (
            res.ok &&
            data.ok === true &&
            (data.releaseId || 'legacy') === expected
          )
            return true;
        } catch {
          /* readiness only, never Doris or Meta */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return false;
    };
    const previous = await activateRelease(root, next, { restart, healthy });
    console.log(
      `发布成功：${id}。上个版本：${previous?.id || 'legacy'}。旧发布目录保留，可回退；未修改 Meta 工具。`,
    );
  }
} finally {
  rmdirSync(lock);
}
