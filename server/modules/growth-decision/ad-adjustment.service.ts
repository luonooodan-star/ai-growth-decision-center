import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ADJUSTMENT_REFRESH_MS,
  type AdjustmentDay,
  type AdjustmentQuery,
} from '@shared/ad-adjustment.interface';
import { PaidGrowthService, validateBiQuery } from './paid-growth.service';

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
  constructor(private readonly bi: PaidGrowthService) {}

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
    const filters = {
      ...(q.appId ? { app_id: Number(q.appId) } : {}),
      ...(q.media ? { media_source: q.media } : {}),
    };
    const base = {
      start_date: q.date,
      end_date: q.date,
      dimensions: ADJUSTMENT_DIMENSIONS,
    };
    const read = (args: Record<string, unknown>) =>
      this.bi.part(
        args,
        q.refresh === '1',
        ADJUSTMENT_REFRESH_MS,
        'adjustment-v1:',
      );
    const daily = await read({
      ...base,
      dataset: 'bi_ads.ads_paid_acquisition_daily',
      metrics: ['spend', 'impressions', 'media_clicks', 'media_installs'],
      filters_json: JSON.stringify(filters),
    });
    const revenue = await read({
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
    const accounts =
      !q.media || q.media === 'facebook'
        ? await read({
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
          })
        : { rows: [], state: 'unsupported' as const };
    return { date: q.date, daily, revenue, accounts };
  }
}
