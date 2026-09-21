import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ADJUSTMENT_REFRESH_MS,
  type AdjustmentDay,
  type AdjustmentQuery,
} from '@shared/ad-adjustment.interface';
import { PaidGrowthService, validateBiQuery } from './paid-growth.service';
import type { BiPart } from '@shared/paid-growth.interface';

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
  ): Promise<BiPart> {
    const key = JSON.stringify([args, refresh]);
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.waiting.length >= 100)
      throw new BadRequestException('当前查询较多，请稍后重试');
    const task = (async () => {
      if (this.running >= 3)
        await new Promise<void>((resolve) => this.waiting.push(resolve));
      else this.running++;
      try {
        return await this.bi.part(
          args,
          refresh,
          ADJUSTMENT_REFRESH_MS,
          'adjustment-v2:',
        );
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
    const filters = {
      ...(q.appId ? { app_id: Number(q.appId) } : {}),
      ...(q.media ? { media_source: q.media } : {}),
      ...(q.campaignId ? { campaign_id: q.campaignId } : {}),
    };
    const base = {
      start_date: q.date,
      end_date: q.date,
      // Keep country × optimizer intersections for AND filters; defer hierarchy.
      dimensions: q.campaignId
        ? ADJUSTMENT_DIMENSIONS
        : ADJUSTMENT_DIMENSIONS.filter(
            (field) =>
              !field.startsWith('adgroup_') && !field.startsWith('creative_'),
          ),
    };
    const read = (args: Record<string, unknown>) =>
      this.read(args, q.date === today && q.refresh === '1');
    const dailyTask = read({
      ...base,
      dataset: 'bi_ads.ads_paid_acquisition_daily',
      metrics: ['spend', 'impressions', 'media_clicks', 'media_installs'],
      filters_json: JSON.stringify(filters),
    });
    const revenueTask = read({
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
        ? this.read(
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
    const [daily, revenue, accounts] = await Promise.all([
      dailyTask,
      revenueTask,
      accountsTask,
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
    };
  }
}
