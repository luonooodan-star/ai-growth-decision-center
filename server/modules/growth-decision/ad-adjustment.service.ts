import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ADJUSTMENT_REFRESH_MS,
  type AdjustmentDay,
  type AdjustmentQuery,
} from '@shared/ad-adjustment.interface';
import { PaidGrowthService, validateBiQuery } from './paid-growth.service';
import type { BiPart } from '@shared/paid-growth.interface';
import { personalScopeKey } from '../../common/utils/personal-doris';

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
  constructor(private readonly bi: PaidGrowthService) {}

  private read(
    args: Record<string, unknown>,
    refresh: boolean,
    cacheOnly = false,
  ): Promise<BiPart> {
    // Cache peeks never wait for active Doris work. Same query shares BI cache.
    if (cacheOnly)
      return this.bi.part(args, false, ADJUSTMENT_REFRESH_MS, '', true);
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
        return await this.bi.part(args, refresh, ADJUSTMENT_REFRESH_MS, '');
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
              field !== 'buyer_alias' &&
              field !== 'country_code',
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
    const dailyTask = read('daily', {
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
    });
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
      !q.media || q.media === 'facebook'
        ? read(
            'accounts',
            {
              dataset: 'bi_dwd.dwd_facebook_campaign_daily',
              start_date: q.date,
              end_date: q.date,
              dimensions: [
                'app_id',
                'advertiser_id',
                'campaign_id',
                'country_code',
              ],
              metrics: ['spend'],
              filters_json: JSON.stringify(
                q.appId ? { app_id: Number(q.appId) } : {},
              ),
            },
            !q.campaignId && q.date === today && q.refresh === '1',
          )
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
      options,
      timings,
    };
  }
}
