import {
  Logger,
  Controller,
  Get,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { centerIdentity } from '../../common/utils/center-identity';

type Balance = {
  id: string;
  name: string;
  currency: string;
  balance: string | null;
  reminder: boolean;
};
type Snapshot = {
  slot: number;
  rows: Balance[];
  updatedAt?: string;
  error?: string;
};
const folder = () => join(process.cwd(), 'runtime/tiktok');
const halfDay = 12 * 3600000;
const slotNow = () => Math.floor((Date.now() + 8 * 3600000) / halfDay);

async function pages<T>(
  token: string,
  path: string,
  field: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 10000; page++) {
    const url = new URL(
      'https://business-api.tiktok.com/open_api/v1.3/' + path,
    );
    url.search = new URLSearchParams({
      ...params,
      page: String(page),
      page_size: '50',
    }).toString();
    const response = await fetch(url, {
      headers: { 'Access-Token': token },
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      const detail = [
        path,
        '错误码 ' + String(payload.code ?? response.status),
        '第 ' + page + ' 页',
      ];
      if (params.bc_id) detail.push('BC ' + params.bc_id);
      if (typeof payload.message === 'string') detail.push(payload.message);
      if (typeof payload.request_id === 'string')
        detail.push('Request ID ' + payload.request_id);
      throw new Error(
        'TikTok 请求失败（' +
          detail.join(' · ').split(token).join('[已隐藏]').slice(0, 1200) +
          '）',
      );
    }
    const batch = payload.data?.[field];
    if (!Array.isArray(batch)) throw new Error('TikTok 返回的账户列表格式异常');
    rows.push(...batch);
    if (
      payload.data.page_info?.total_page != null
        ? page >= Number(payload.data.page_info.total_page)
        : batch.length < 50
    )
      return rows;
  }
  throw new Error('TikTok 账户分页读取未完成');
}

async function loadBalances(token: string) {
  const centers = await pages<{ bc_info: { bc_id: string } }>(
    token,
    'bc/get/',
    'list',
  );
  const rows = new Map<string, Balance>();
  for (const id of new Set(centers.map((c) => c.bc_info.bc_id))) {
    if (typeof id !== 'string' || !/^\d+$/.test(id))
      throw new Error('TikTok 返回无效的 BC ID');
    const accounts = await pages<{
      advertiser_id: string;
      advertiser_name?: string;
      currency?: string;
      valid_account_balance?: number | string | null;
      balance_reminder?: boolean;
    }>(token, 'advertiser/balance/get/', 'advertiser_account_list', {
      bc_id: id,
    });
    for (const item of accounts) {
      if (
        typeof item.advertiser_id !== 'string' ||
        !/^\d+$/.test(item.advertiser_id)
      )
        throw new Error('TikTok 返回无效的账户 ID');
      rows.set(item.advertiser_id, {
        id: item.advertiser_id,
        name: item.advertiser_name ?? '',
        currency: item.currency ?? '',
        balance:
          item.valid_account_balance == null
            ? null
            : String(item.valid_account_balance),
        reminder: item.balance_reminder === true,
      });
    }
  }
  return Array.from(rows.values());
}

@Controller('api/center/tiktok')
export class TikTokBalanceController {
  private timer?: NodeJS.Timeout;
  private pending?: Promise<{
    configured: boolean;
    rows?: Balance[];
    updatedAt?: string;
    error?: string;
  }>;
  onModuleInit() {
    const tick = () => {
      void this.report(false).catch(() =>
        Logger.error('TikTok 余额缓存读写失败', 'TikTokBalanceController'),
      );
    };
    tick();
    this.timer = setInterval(tick, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  private report(force: boolean) {
    if (!this.pending)
      this.pending = this.update(force).finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private async update(force: boolean) {
    let token = process.env.TIKTOK_ACCESS_TOKEN?.trim();
    if (!token) {
      try {
        token = (await readFile(join(folder(), 'access-token'), 'utf8')).trim();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    if (!token) return { configured: false };
    const key = createHash('sha256').update(token).digest('hex');
    const file = join(folder(), 'balances-' + key + '.json');
    let state: Snapshot = { slot: -1, rows: [] };
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    async function save() {
      await mkdir(folder(), { recursive: true, mode: 0o700 });
      await writeFile(file + '.tmp', JSON.stringify(state), { mode: 0o600 });
      await rename(file + '.tmp', file);
    }
    if (force || state.slot !== slotNow()) {
      state.slot = slotNow();
      state.error = '本轮抓取未完成，可手动刷新';
      await save();
      try {
        state.rows = await loadBalances(token);
        state.updatedAt = new Date().toISOString();
        delete state.error;
      } catch (e) {
        state.error = e instanceof Error ? e.message : 'TikTok 查询失败';
      }
      await save();
    }
    return {
      configured: true,
      rows: state.rows,
      updatedAt: state.updatedAt,
      error: state.error,
    };
  }
  @Get('balances') balances() {
    if (!centerIdentity.getStore()) throw new UnauthorizedException();
    return this.report(false);
  }
  @Post('balances/refresh') async refresh() {
    if (!centerIdentity.getStore()) throw new UnauthorizedException();
    // A cached read in flight must not swallow an explicit refresh.
    if (this.pending) await this.pending;
    return this.report(true);
  }
}
