import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ADJUSTMENT_REFRESH_MS,
  type AdjustmentDay,
  type AdjustmentQuery,
} from '@shared/ad-adjustment.interface';
import { PaidGrowthService, validateBiQuery } from './paid-growth.service';
import type { BiPart } from '@shared/paid-growth.interface';
import { personalScopeKey } from '../../common/utils/personal-doris';
import { MetaAdjustmentService } from './meta-adjustment.service';
import { biNumber } from '@shared/paid-growth';
import { randomUUID } from 'node:crypto';

export function accountVerificationIds(rows: BiPart['rows']): string[] {
  const campaigns = new Map<string, { spend: number; unknown: boolean }>();
  for (const row of rows) {
    const id = String(row.campaign_id || '');
    if (!/^\d{1,40}$/.test(id)) continue;
    const value = campaigns.get(id) || { spend: 0, unknown: false };
    const spend = biNumber(row.spend);
    if (spend === null) value.unknown = true;
    else value.spend += spend;
    campaigns.set(id, value);
  }
  return [...campaigns]
    .filter(([, value]) => value.unknown || value.spend !== 0)
    .sort(([a, av], [b, bv]) => bv.spend - av.spend || a.localeCompare(b))
    .map(([id]) => id);
}

// Verified against Doris list_datasets: both sources expose the same hierarchy.
export const ADJUSTMENT_DIMENSIONS = [
  'app_id',
  'app_name',
  'media_source',
  'campaign_id',
  'campaign_name',
  'adgroup_id',
  'adgroup_name',
  'creative_id',
  'creative_name',
  'buyer_alias',
  'country_code',
];

@Injectable()
export class AdAdjustmentService {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly pending = new Map<string, Promise<BiPart>>();
  private readonly accountSessions = new Map<
    string,
    {
      scope: string;
      query: string;
      ids: string[];
      until: number;
    }
  >();
  constructor(
    private readonly bi: PaidGrowthService,
    private readonly meta?: MetaAdjustmentService,
  ) {}

  private read(
    args: Record<string, unknown>,
    refresh: boolean,
    cacheOnly = false,
  ): Promise<BiPart> {
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
    // Historical D0 may still receive late arrivals; refresh at most daily.
    const ttl =
      String(args.end_date) < today
        ? 24 * 60 * 60 * 1000
        : ADJUSTMENT_REFRESH_MS;
    // Cache peeks never wait for active Doris work. Same query shares BI cache.
    if (cacheOnly) return this.bi.part(args, false, ttl, '', true);
    const key = JSON.stringify([personalScopeKey(), args, refresh]);
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.waiting.length >= 100)
      throw new BadRequestException('当前查询较多，请稍后重试');
    const task = (async () => {
      if (this.running >= 3)
        await new Promise<void>((resolve) => this.waiting.push(resolve));
      else this.running++;
      try {
        return await this.bi.part(args, refresh, ttl, '');
      } finally {
        const next = this.waiting.shift();
        if (next) next();
        else this.running--;
      }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  async day(q: AdjustmentQuery): Promise<AdjustmentDay> {
    validateBiQuery({ ...q, level: 'campaigns' });
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
    const oldest = new Date(Date.parse(today) - 2 * 86400000)
      .toISOString()
      .slice(0, 10);
    if (q.date < oldest || q.date > today)
      throw new BadRequestException('广告调整页仅查询今天和前两天');
    if (!q.appId || !q.media)
      throw new BadRequestException('请先选择产品和渠道');
    if (q.campaignId !== undefined && !/^\d{1,40}$/.test(q.campaignId))
      throw new BadRequestException('广告系列 ID 无效');
    if (q.accountOffset !== undefined && !/^\d{1,7}$/.test(q.accountOffset))
      throw new BadRequestException('账户核验分页无效');
    if (q.part && !['daily', 'revenue', 'accounts', 'options'].includes(q.part))
      throw new BadRequestException('数据类型无效');
    for (const value of [q.optimizer, q.country])
      if (
        value !== undefined &&
        (typeof value !== 'string' || value.length > 100)
      )
        throw new BadRequestException('筛选条件无效');
    const filters = {
      ...(q.appId ? { app_id: Number(q.appId) } : {}),
      ...(q.media ? { media_source: q.media } : {}),
      ...(q.campaignId ? { campaign_id: q.campaignId } : {}),
      ...(q.optimizer ? { buyer_alias: q.optimizer } : {}),
      ...(q.country ? { country_code: q.country } : {}),
    };
    const base = {
      start_date: q.date,
      end_date: q.date,
      dimensions: q.campaignId
        ? ADJUSTMENT_DIMENSIONS
        : ADJUSTMENT_DIMENSIONS.filter(
            (field) =>
              !field.startsWith('adgroup_') &&
              !field.startsWith('creative_') &&
              (q.localFilters === '1' ||
                (field !== 'buyer_alias' && field !== 'country_code')),
          ),
    };
    const timings: Record<string, number> = {};
    const read = async (
      part: string,
      args: Record<string, unknown>,
      force = q.date === today && q.refresh === '1',
    ) => {
      if (q.part && q.part !== part)
        return { rows: [], state: 'missing' as const, message: '等待加载' };
      const started = Date.now();
      try {
        return await this.read(args, force, q.cacheOnly === '1');
      } finally {
        timings[part] = Date.now() - started;
      }
    };
    const dailyArgs = {
      ...base,
      dataset: 'bi_ads.ads_paid_acquisition_daily',
      metrics: [
        'spend',
        'impressions',
        'media_clicks',
        'media_installs',
        'adjust_installs',
      ],
      filters_json: JSON.stringify(filters),
    };
    const dailyTask = read('daily', dailyArgs);
    const revenueTask = read('revenue', {
      ...base,
      dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
      metrics: ['metric_value'],
      filters_json: JSON.stringify({
        ...filters,
        cohort_index: 0,
        cohort_unit: 'D',
        metric_id: 'revenue',
      }),
    });
    const accountsTask =
      q.date < today
        ? Promise.resolve({
            rows: [],
            state: 'unsupported' as const,
            message: '历史指标无需重复核验 Meta 账户；操作权限以当前校验为准',
          })
        : !q.media || q.media === 'facebook'
          ? this.personalAccounts(q, {
              ...dailyArgs,
              // Ownership needs only the campaign manifest, never the country
              // and buyer cross-product. Reuse the lightweight BI summary cache.
              dimensions: ADJUSTMENT_DIMENSIONS.filter(
                (field) =>
                  !field.startsWith('adgroup_') &&
                  !field.startsWith('creative_') &&
                  field !== 'buyer_alias' &&
                  field !== 'country_code',
              ),
            })
          : Promise.resolve({ rows: [], state: 'unsupported' as const });
    const optionsTask =
      q.part === 'options'
        ? read(
            'options',
            {
              dataset: 'bi_ads.ads_paid_acquisition_daily',
              start_date: q.date,
              end_date: q.date,
              dimensions: ['buyer_alias', 'country_code'],
              metrics: ['spend'],
              filters_json: JSON.stringify({
                app_id: Number(q.appId),
                media_source: q.media,
              }),
            },
            false,
          )
        : Promise.resolve(undefined);
    const [daily, revenue, accounts, options] = await Promise.all([
      dailyTask,
      revenueTask,
      accountsTask,
      optionsTask,
    ]);
    return {
      date: q.date,
      daily,
      revenue,
      accounts: q.campaignId
        ? {
            ...accounts,
            rows: accounts.rows.filter(
              (r) => String(r.campaign_id) === q.campaignId,
            ),
          }
        : accounts,
      granularity: q.campaignId ? 'detail' : 'campaign',
      scope: { optimizer: q.optimizer || '', country: q.country || '' },
      filterable: q.localFilters === '1' && !q.optimizer && !q.country,
      options,
      timings,
    };
  }
  private async personalAccounts(
    q: AdjustmentQuery,
    args: Record<string, unknown>,
  ): Promise<BiPart> {
    if ((q.part && q.part !== 'accounts') || q.cacheOnly === '1')
      return {
        rows: [],
        state: 'missing',
        message: '等待本次个人 Meta 归属核验',
      };
    try {
      if (!this.meta) throw new Error('个人 Meta 桥接服务不可用');
      const offset = Number(q.accountOffset || 0);
      let session = q.accountSession;
      let ids: string[];
      if (offset > 0) {
        const saved = session && this.accountSessions.get(session);
        if (
          !saved ||
          saved.until <= Date.now() ||
          saved.scope !== personalScopeKey() ||
          saved.query !== JSON.stringify(args)
        )
          throw new Error('本轮账户核验已过期或筛选已变化，请重新抓取');
        ids = saved.ids;
      } else {
        // Only resolve IDs visible through this user's Doris key. No DWD/admin key fallback.
        const daily = await this.read(args, false);
        if (!['fresh', 'cached'].includes(daily.state))
          return {
            rows: [],
            state: 'missing',
            message: '个人 Doris 明细未完整返回，暂不核验 Meta 归属',
          };
        // Only omit zero-spend rows after the source passed completeness checks.
        // Unknown spend is not zero; high-spend visible rows get controls first.
        ids = accountVerificationIds(daily.rows);
        session = randomUUID();
        for (const [key, value] of this.accountSessions)
          if (value.until <= Date.now()) this.accountSessions.delete(key);
        this.accountSessions.set(session, {
          scope: personalScopeKey(),
          query: JSON.stringify(args),
          ids,
          until: Date.now() + 600000,
        });
        while (this.accountSessions.size > 64)
          this.accountSessions.delete(
            this.accountSessions.keys().next().value!,
          );
      }
      const rows: BiPart['rows'] = [];
      let unavailable = 0;
      let ownerId: string | undefined;
      // One bounded page per HTTP request. Previously all campaigns were held
      // until the last batch finished, discarding successes after a timeout.
      if (offset < ids.length) {
        const batch = ids.slice(offset, offset + 10);
        const result = await this.meta.campaignAccounts(batch);
        if (!result.ownerId || !Array.isArray(result.campaigns))
          throw new Error('请更新原工具适配器并重新授权');
        ownerId = result.ownerId;
        const valid = result.campaigns.filter(
          (c) => batch.includes(c.campaignId) && /^\d{1,40}$/.test(c.accountId),
        );
        unavailable += batch.length - valid.length;
        rows.push(
          ...valid.map((c) => ({
            app_id: Number(q.appId),
            campaign_id: c.campaignId,
            advertiser_id: c.accountId,
          })),
        );
      }
      return {
        rows,
        accountOwnerId: ownerId,
        accountTotal: ids.length,
        accountSession: session,
        accountNextOffset: offset + 10 < ids.length ? offset + 10 : undefined,
        state: 'fresh',
        updatedAt: new Date().toISOString(),
        message: unavailable
          ? `${unavailable} 个系列无法通过当前个人 Meta 身份确认归属，其操作继续禁用；其他系列已核验。`
          : '账户归属已通过当前用户个人 Meta 授权核验',
      };
    } catch (error) {
      return {
        rows: [],
        state: 'missing',
        message:
          error instanceof Error ? error.message : '个人 Meta 账户归属核验失败',
      };
    }
  }
}
