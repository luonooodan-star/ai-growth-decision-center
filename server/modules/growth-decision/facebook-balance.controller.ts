import { scheduledBalanceMinute } from '@shared/balance-schedule';
import { facebookBalanceSource } from '@shared/facebook-balances';
import {
  Controller,
  Get,
  Header,
  Post,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FacebookBalanceRow } from '@shared/meta-adjustment';
import { centerIdentity } from '../../common/utils/center-identity';
import { readCenterRole } from '../../common/utils/center-role';
import { MetaAdjustmentService } from './meta-adjustment.service';

type Snapshot = {
  slot: number;
  binding: number;
  rows: FacebookBalanceRow[];
  updatedAt?: string;
  error?: string;
};
const folder = () => join(process.cwd(), 'runtime/facebook-balances');
function bindings() {
  const file = join(process.cwd(), 'runtime/meta-local-bridge.json.users');
  const active = new Map<string, number>();
  if (!existsSync(file)) return active;
  if (statSync(file).mode & 0o077)
    throw new Error('个人授权文件权限必须为 0600');
  const sessions: Record<string, { until: number }> = JSON.parse(
    readFileSync(file, 'utf8'),
  ).sessions;
  for (const [user, session] of Object.entries(sessions))
    if (
      /^[a-zA-Z0-9_-]{1,40}$/.test(user) &&
      Number.isSafeInteger(session.until) &&
      session.until > Date.now()
    )
      active.set(user, session.until);
  return active;
}
function save(file: string, data: Snapshot) {
  mkdirSync(folder(), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomUUID();
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
  renameSync(tmp, file);
}

@Controller('api/center/facebook/balances')
export class FacebookBalanceController {
  private timer?: NodeJS.Timeout;
  private scanning = false;
  private pending = new Map<string, Promise<Snapshot>>();
  constructor(private readonly meta: MetaAdjustmentService) {}
  onModuleInit() {
    const tick = async () => {
      const slot = scheduledBalanceMinute();
      if (slot === null || this.scanning) return;
      this.scanning = true;
      try {
        for (const user of bindings().keys()) {
          if (facebookBalanceSource(user) !== user) continue;
          try {
            if ((await readCenterRole(user)) === 'operator')
              await centerIdentity.run(user, () => this.report(false, slot));
          } catch {
            Logger.warn(
              '个人 FB 余额后台检查未完成',
              'FacebookBalanceController',
            );
          }
        }
      } catch {
        Logger.error(
          'FB 余额后台检查无法读取个人授权',
          'FacebookBalanceController',
        );
      } finally {
        this.scanning = false;
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), 15000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list() {
    return this.viewerReport(false);
  }
  @Post('refresh')
  @Header('Cache-Control', 'private, no-store')
  refresh() {
    return this.viewerReport(true);
  }

  private async viewerReport(force: boolean) {
    const viewer = centerIdentity.getStore();
    if (!viewer) throw new UnauthorizedException('请登录决策中心');
    const source = facebookBalanceSource(viewer);
    if (source === viewer) return this.report(force);
    if ((await readCenterRole(source).catch(() => null)) !== 'operator')
      throw new BadRequestException('growth 当前无法提供共享 FB 余额');
    try {
      return await centerIdentity.run(source, () => this.report(force));
    } catch (error) {
      if (error instanceof UnauthorizedException)
        throw new BadRequestException(
          'growth 的 Meta 授权已过期或发生变化，请由 growth 检查授权后刷新余额',
        );
      throw error;
    }
  }

  private async report(force: boolean, slot = scheduledBalanceMinute()) {
    const user = centerIdentity.getStore();
    if (!user) throw new UnauthorizedException('请登录决策中心');
    const binding = bindings().get(user);
    if (!binding)
      throw new UnauthorizedException('请在「授权与连接」绑定我的 Meta');
    const file = join(folder(), user + '.json');
    const current = this.pending.get(user);
    if (current) {
      const result = await current;
      if (result.binding !== binding || bindings().get(user) !== binding)
        throw new UnauthorizedException('个人 Meta 授权已变化，请刷新');
      return result;
    }
    let snapshot: Snapshot = { slot: -1, binding, rows: [] };
    if (existsSync(file)) {
      const prior: Snapshot = JSON.parse(readFileSync(file, 'utf8'));
      if (prior.binding === binding) snapshot = prior;
      else if (prior.slot === slot) {
        if (slot !== null) snapshot.slot = slot;
        snapshot.error = '个人 Meta 授权已更新，请手动刷新或等待下次自动抓取';
      }
    }
    if (!force && (slot === null || snapshot.slot === slot)) return snapshot;
    if (slot !== null) snapshot.slot = slot;
    save(file, { ...snapshot, error: '刷新尚未完成，可手动重试' });
    const task = this.collect(user, binding, file, snapshot).finally(() =>
      this.pending.delete(user),
    );
    this.pending.set(user, task);
    return task;
  }

  private async collect(
    user: string,
    binding: number,
    file: string,
    snapshot: Snapshot,
  ) {
    const accounts = new Map<string, FacebookBalanceRow>();
    const cursors = new Set<string>();
    let ownerId: string | undefined;
    let after: string | undefined;
    try {
      do {
        const page = await this.meta.billingPage(after, ownerId);
        if (!page.ownerId || (ownerId && ownerId !== page.ownerId))
          throw new Error('个人 Meta 身份已变化');
        ownerId = page.ownerId;
        for (const row of page.rows) accounts.set(row.id, row);
        after = page.next || undefined;
        if (after && cursors.has(after))
          throw new Error('Meta 返回重复分页游标，账户清单未更新');
        if (after) cursors.add(after);
      } while (after);
      snapshot = {
        ...snapshot,
        rows: [...accounts.values()],
        updatedAt: new Date().toISOString(),
        error: undefined,
      };
    } catch (e) {
      snapshot = {
        ...snapshot,
        rows: [],
        updatedAt: undefined,
        error: e instanceof Error ? e.message : '读取 FB 账户失败',
      };
    }
    if (bindings().get(user) !== binding)
      throw new UnauthorizedException('个人 Meta 授权已变化，请刷新');
    save(file, snapshot);
    return snapshot;
  }
}
