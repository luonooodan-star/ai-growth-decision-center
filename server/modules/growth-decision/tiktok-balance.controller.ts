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
  centers?: string[];
  id: string;
  name: string;
  currency: string;
  balance: string | null;
  reminder: boolean;
};
type Snapshot = {
  summaries?: string[];
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
  const centers = await pages<{ bc_info: { bc_id: string; name?: string } }>(
    token,
    'bc/get/',
    'list',
  );
  const rows = new Map<string, Balance>();
  const failures: string[] = [];
  const summaries: string[] = [];
  let successes = 0;
  const directory = new Map(
    centers.map(({ bc_info }) => [bc_info.bc_id, bc_info.name]),
  );
  for (const [id, name] of directory) {
    if (typeof id !== 'string' || !/^\d+$/.test(id))
      throw new Error('TikTok 返回无效的 BC ID');
    const label = name || id;
    const visible = new Set<string>();
    const funded = new Set<string>();
    let assetsRead = false;
    let financesRead = false;
    try {
      const assets = await pages<{ asset_id: string; asset_name?: string }>(
        token,
        'bc/asset/get/',
        'list',
        { bc_id: id, asset_type: 'ADVERTISER' },
      );
      for (const asset of assets) {
        if (typeof asset.asset_id !== 'string' || !/^\d+$/.test(asset.asset_id))
          throw new Error('TikTok 返回无效的资产 ID');
        visible.add(asset.asset_id);
        if (!rows.has(asset.asset_id))
          rows.set(asset.asset_id, {
            id: asset.asset_id,
            name: asset.asset_name || '',
            balance: null,
            currency: '',
            reminder: false,
          });
      }
      assetsRead = true;
    } catch (error) {
      failures.push(
        label +
          ' 账户目录：' +
          (error instanceof Error ? error.message : '读取失败'),
      );
    }
    try {
      const accounts = await pages<{
        advertiser_id: string;
        advertiser_name?: string;
        currency?: string;
        valid_account_balance?: number | string | null;
        balance_reminder?: boolean;
      }>(token, 'advertiser/balance/get/', 'advertiser_account_list', {
        bc_id: id,
      });
      const batch: Balance[] = [];
      for (const item of accounts) {
        if (
          typeof item.advertiser_id !== 'string' ||
          !/^\d+$/.test(item.advertiser_id)
        )
          throw new Error('TikTok 返回无效的账户 ID');
        batch.push({
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
      for (const item of batch) {
        visible.add(item.id);
        const prior = rows.get(item.id);
        if (item.balance !== null) funded.add(item.id);
        if (!prior || item.balance !== null || prior.balance === null)
          rows.set(item.id, {
            ...item,
            name: item.name || prior?.name || '',
            centers: prior?.centers,
          });
      }
      financesRead = true;
      successes++;
    } catch (error) {
      failures.push(
        (name || id) +
          '：' +
          (error instanceof Error ? error.message : '余额查询失败'),
      );
    }
    for (const key of visible) {
      const row = rows.get(key)!;
      row.centers = Array.from(new Set([...(row.centers || []), label]));
    }
    summaries.push(
      label +
        ' · ' +
        visible.size +
        ' 个可见账户 · ' +
        (financesRead ? funded.size + ' 个返回余额' : '余额查询失败') +
        (assetsRead ? '' : ' · 目录查询失败'),
    );
  }
  const error = failures.length ? failures.join('；') : undefined;
  if (error && !successes && !rows.size) throw new Error(error);
  return { rows: Array.from(rows.values()), error, summaries };
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
        const result = await loadBalances(token);
        state.rows = result.rows;
        state.summaries = result.summaries;
        state.updatedAt = new Date().toISOString();
        state.error = result.error;
      } catch (e) {
        state.error = e instanceof Error ? e.message : 'TikTok 查询失败';
      }
      await save();
    }
    return {
      configured: true,
      rows: state.rows,
      summaries: state.summaries,
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
