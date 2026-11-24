import { scheduledBalanceMinute } from '@shared/balance-schedule';
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

import {
  collectWebBudgets,
  webBudgetAccounts,
  type WebBudget,
} from './tiktok-web-budget';

const accountAssignees = new Map<string, string>([
  ['7707161933644070920', 'jsa'],
  ['7708966116054482965', 'jsa'],
  ['7708967507062751240', 'jsa'],
  ['7708967467330338868', 'jsa'],
  ['7708966031700033557', 'lzx'],
  ['7686388615521386504', 'lzx'],
  ['7703780802865446930', 'lzx'],
  ['7703780764701736968', 'lzx'],
  ['7699737911520198663', 'lzx'],
  ['7704571607515299861', 'fjx'],
  ['7699737926401507346', 'fjx'],
  ['7686388252760342536', 'fjx'],
  ['7708966298666958856', 'fjx'],
]);

type Balance = {
  webBudget?: WebBudget;
  webBudgetError?: string;
  centers?: string[];
  owner?: string;
  detailBalance?: boolean;
  id: string;
  name: string;
  currency: string;
  balance: string | null;
  remaining?: string;
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

async function queryTikTok(
  token: string,
  path: string,
  params: Record<string, string>,
) {
  const url = new URL('https://business-api.tiktok.com/open_api/v1.3/' + path);
  url.search = new URLSearchParams(params).toString();
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
      ...(params.page ? ['第 ' + params.page + ' 页'] : []),
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
  return payload;
}

async function pages<T>(
  token: string,
  path: string,
  field: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 10000; page++) {
    const payload = await queryTikTok(token, path, {
      ...params,
      page: String(page),
      page_size: '50',
    });
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
  const coverage: {
    label: string;
    visible: Set<string>;
    assetsRead: boolean;
    financesRead: boolean;
  }[] = [];
  let successes = 0;
  const directory = new Map(
    centers.map(({ bc_info }) => [bc_info.bc_id, bc_info.name]),
  );
  for (const [id, name] of directory) {
    if (typeof id !== 'string' || !/^\d+$/.test(id))
      throw new Error('TikTok 返回无效的 BC ID');
    const label = name || id;
    const visible = new Set<string>();

    let assetsRead = false;
    let financesRead = false;
    try {
      const assets = await pages<{
        asset_id: string;
        asset_name?: string;
        owner_bc_name?: string;
      }>(token, 'bc/asset/get/', 'list', {
        bc_id: id,
        asset_type: 'ADVERTISER',
      });
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
        if (asset.owner_bc_name)
          rows.get(asset.asset_id)!.owner = asset.owner_bc_name;
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
        budget_remaining?: number | string | null;
        budget_mode?: string;
        balance_reminder?: boolean;
      }>(token, 'advertiser/balance/get/', 'advertiser_account_list', {
        bc_id: id,
        fields: JSON.stringify(['budget_remaining']),
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
          remaining:
            item.budget_mode === 'UNLIMITED'
              ? '不限额'
              : item.budget_remaining == null
                ? undefined
                : String(item.budget_remaining),
          reminder: item.balance_reminder === true,
        });
      }
      for (const item of batch) {
        visible.add(item.id);
        const prior = rows.get(item.id);

        rows.set(item.id, {
          ...item,
          balance: item.balance ?? prior?.balance ?? null,
          remaining: item.remaining ?? prior?.remaining,
          currency: item.currency || prior?.currency || '',
          reminder: item.reminder || !!prior?.reminder,
          name: item.name || prior?.name || '',
          centers: prior?.centers,
          owner: prior?.owner,
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
    coverage.push({ label, visible, assetsRead, financesRead });
  }
  const missing = Array.from(rows.values()).filter(
    (row) => row.balance === null,
  );
  async function fill(row: Balance) {
    try {
      const payload = await queryTikTok(token, 'advertiser/info/', {
        advertiser_ids: JSON.stringify([row.id]),
        fields: JSON.stringify(['advertiser_id', 'currency', 'balance']),
      });
      const item = payload.data?.list?.find(
        (entry: { advertiser_id: string }) => entry.advertiser_id === row.id,
      );
      if (
        item &&
        (typeof item.balance === 'number' ||
          (typeof item.balance === 'string' && item.balance.trim()))
      ) {
        row.balance = String(item.balance);
        row.currency = item.currency || '';
        row.detailBalance = true;
      }
    } catch (e) {
      failures.push(
        row.id + ' 账户详情：' + (e instanceof Error ? e.message : '查询失败'),
      );
    }
  }
  for (let i = 0; i < missing.length; i += 2)
    await Promise.all(missing.slice(i, i + 2).map(fill));
  const summaries = coverage.map(
    ({ label, visible, assetsRead, financesRead }) => {
      const count = Array.from(visible).filter(
        (id) => rows.get(id)!.balance !== null,
      ).length;
      return (
        label +
        ' · ' +
        visible.size +
        ' 个可见账户 · ' +
        count +
        ' 个返回金额' +
        (assetsRead ? '' : ' · 目录查询失败') +
        (financesRead ? '' : ' · BC 财务查询失败')
      );
    },
  );
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
      if (scheduledBalanceMinute() === null) return;
      void this.report(false).catch(() =>
        Logger.error('TikTok 余额缓存读写失败', 'TikTokBalanceController'),
      );
    };
    tick();
    this.timer = setInterval(tick, 15000);
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
    const slot = scheduledBalanceMinute();
    let token = process.env.TIKTOK_ACCESS_TOKEN?.trim();
    if (!token) {
      try {
        token = (await readFile(join(folder(), 'access-token'), 'utf8')).trim();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    const ids = await webBudgetAccounts(folder());
    if (!token && !ids.length) return { configured: false };
    const key = token
      ? createHash('sha256').update(token).digest('hex')
      : 'web-only';
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
    if (force || (slot !== null && state.slot !== slot)) {
      if (slot !== null) state.slot = slot;
      state.error = '本轮抓取未完成，可手动刷新';
      await save();
      const previous = new Map(
        state.rows.map((row) => [row.id, row.webBudget]),
      );
      try {
        const result = token
          ? await loadBalances(token)
          : { rows: [], summaries: [], error: undefined };
        state.rows = result.rows;
        state.summaries = result.summaries;
        state.updatedAt = new Date().toISOString();
        state.error = result.error;
      } catch (e) {
        state.error = e instanceof Error ? e.message : 'TikTok 查询失败';
      }
      try {
        const targets = new Set(ids);
        for (const row of state.rows) {
          if (/^sinox/i.test(row.name.trimStart())) targets.add(row.id);
        }
        const budgets = await collectWebBudgets(folder(), [...targets]);
        const byId = new Map(state.rows.map((row) => [row.id, row]));
        for (const [id, result] of budgets) {
          let row = byId.get(id);
          if (!row) {
            row = {
              id,
              name: '',
              currency: '',
              balance: null,
              reminder: false,
            };
            state.rows.push(row);
          }
          row.webBudget = result.budget ?? previous.get(id);
          row.webBudgetError = result.error;
        }
      } catch {
        state.error = [state.error, '无法读取公司 Mac 的网页预算配置']
          .filter(Boolean)
          .join('；');
      }
      await save();
    }
    return {
      configured: true,
      rows: state.rows.map((row) => ({
        ...row,
        assignee: accountAssignees.get(row.id),
      })),
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
