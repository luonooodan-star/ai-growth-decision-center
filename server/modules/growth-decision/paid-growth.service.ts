import { BadRequestException, Injectable } from '@nestjs/common';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { BI_DIMENSIONS } from '@shared/paid-growth';
import {
  BI_LEVELS,
  type BiDay,
  type BiPart,
  type BiProduct,
  type BiQuery,
} from '@shared/paid-growth.interface';
import { GrowthDataFetchService } from './growth-data-fetch.service';
import { GrowthDecisionService } from './growth-decision.service';
import { completeBiQuery } from './paid-growth-query';
import { personalScopeKey } from '../../common/utils/personal-doris';

const DAILY = 'bi_ads.ads_paid_acquisition_daily';
const COHORT = 'bi_ads.ads_paid_acquisition_cohort_metric';
export function validateBiQuery(q: BiQuery): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ||
    !Number.isFinite(Date.parse(q.date)) ||
    new Date(q.date).toISOString().slice(0, 10) !== q.date
  )
    throw new BadRequestException('日期无效');
  if (!Object.hasOwn(BI_LEVELS, q.level))
    throw new BadRequestException('不支持的查看维度');
  if (q.appId && (!/^\d+$/.test(q.appId) || Number(q.appId) <= 0))
    throw new BadRequestException('产品 ID 无效');
  if (q.media && (typeof q.media !== 'string' || q.media.length > 100))
    throw new BadRequestException('渠道无效');
}

@Injectable()
export class PaidGrowthService {
  private readonly pending = new Map<string, Promise<BiPart>>();
  private readonly syncPending = new Map<string, Promise<BiProduct[]>>();
  private async query(args: Record<string, unknown>) {
    // All consumers share the bounded/fair gate in GrowthDataFetchService.
    // An extra unbounded FIFO here hides requests from its fairness policy.
    return this.fetcher.queryMetric(args);
  }
  constructor(
    private readonly database: LocalDatabaseService,
    private readonly fetcher: GrowthDataFetchService,
    private readonly growth: GrowthDecisionService,
  ) {}

  async day(q: BiQuery): Promise<BiDay> {
    validateBiQuery(q);
    if (!q.appId) throw new BadRequestException('请先选择产品');
    const filters = {
      app_id: Number(q.appId),
      ...(q.media ? { media_source: q.media } : {}),
    };
    const dimensions = [
      'app_id',
      'app_name',
      'media_source',
      ...BI_DIMENSIONS[q.level],
    ];
    const base = { start_date: q.date, end_date: q.date, dimensions };
    const daily = await this.part(
      {
        ...base,
        dataset: DAILY,
        metrics: [
          'spend',
          'impressions',
          'media_clicks',
          'media_installs',
          'adjust_installs',
        ],
        filters_json: JSON.stringify(filters),
      },
      q.refresh === '1',
    );
    // Cohort source has no adgroup dimension: never allocate campaign revenue to adgroups.
    if (q.level === 'adgroups') {
      const unsupported: BiPart = {
        rows: [],
        state: 'unsupported',
        message: 'cohort 数据源不提供广告组维度；D0 指标请在系列级查看',
      };
      return {
        date: q.date,
        level: q.level,
        daily,
        revenue: unsupported,
        events: unsupported,
      };
    }
    const cohort = { ...base, dataset: COHORT, metrics: ['metric_value'] };
    const mature = {
      ...filters,
      cohort_index: 0,
      cohort_unit: 'D',
    };
    const revenue = await this.part(
      {
        ...cohort,
        filters_json: JSON.stringify({ ...mature, metric_id: 'revenue' }),
      },
      q.refresh === '1',
    );
    const events = await this.part(
      {
        ...cohort,
        filters_json: JSON.stringify({
          ...mature,
          metric_id: 'revenue_events',
        }),
      },
      q.refresh === '1',
    );
    return { date: q.date, level: q.level, daily, revenue, events };
  }

  /** Lightweight all-channel spend for the adjustment overview; shares the BI day cache. */
  channelSpend(date: string, appId: string): Promise<BiPart> {
    validateBiQuery({ date, appId, level: 'channels' });
    if (!appId) throw new BadRequestException('请先选择产品');
    return this.part(
      {
        start_date: date,
        end_date: date,
        dimensions: ['app_id', 'app_name', 'media_source'],
        dataset: DAILY,
        metrics: [
          'spend',
          'impressions',
          'media_clicks',
          'media_installs',
          'adjust_installs',
        ],
        filters_json: JSON.stringify({ app_id: Number(appId) }),
      },
      false,
    ).then((part) => {
      const rows = part.rows.filter((row) => String(row.app_id) === appId);
      return rows.length === part.rows.length
        ? part
        : {
            ...part,
            rows,
            message: [
              part.message,
              `已排除 ${part.rows.length - rows.length} 条其他产品的数据`,
            ]
              .filter(Boolean)
              .join('；'),
          };
    });
  }

  part(
    args: Record<string, unknown>,
    refresh: boolean,
    ttl = 300000,
    namespace = '',
    cacheOnly = false,
  ): Promise<BiPart> {
    const key = personalScopeKey() + ':' + namespace + JSON.stringify(args);
    const raw = this.database.getBiCache(key);
    const cache: BiPart | undefined = raw ? JSON.parse(raw) : undefined;
    if (cacheOnly)
      return Promise.resolve(
        cache
          ? {
              ...cache,
              state:
                cache.updatedAt &&
                Date.now() - Date.parse(cache.updatedAt) < ttl
                  ? 'cached'
                  : 'stale',
            }
          : { rows: [], state: 'missing', message: '暂无缓存，等待抓取' },
      );
    if (
      !refresh &&
      cache?.updatedAt &&
      Date.now() - Date.parse(cache.updatedAt) < ttl
    )
      return Promise.resolve({ ...cache, state: 'cached' });
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = (async (): Promise<BiPart> => {
      try {
        const rows = await completeBiQuery((args) => this.query(args), args);
        const part: BiPart = {
          rows,
          state: 'fresh',
          updatedAt: new Date().toISOString(),
        };
        this.database.saveBiCache(key, JSON.stringify(part));
        return part;
      } catch (error: unknown) {
        return {
          rows: cache?.rows || [],
          updatedAt: cache?.updatedAt,
          state: cache ? 'stale' : 'missing',
          message: error instanceof Error ? error.message : 'Doris 查询失败',
        };
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, promise);
    return promise;
  }

  async products(): Promise<BiProduct[]> {
    const end = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
    const start = new Date(Date.parse(end) - 29 * 86400000)
      .toISOString()
      .slice(0, 10);
    const part = await this.part(
      {
        dataset: DAILY,
        start_date: start,
        end_date: end,
        dimensions: ['app_id', 'app_name', 'media_source'],
        metrics: ['spend'],
        filters_json: '{}',
      },
      false,
    );
    if (part.state === 'missing' || part.state === 'stale')
      throw new BadRequestException(part.message || '产品发现失败，请稍后重试');
    return part.rows
      .filter((r) => Number(r.app_id) > 0 && r.app_name && r.media_source)
      .map((row) => {
        const appId = Number(row.app_id),
          name = String(row.app_name),
          channel = String(row.media_source);
        const product = this.database
          .listProducts()
          .find(
            (p) =>
              p.channel.toLowerCase() === channel.toLowerCase() &&
              (p.dorisAppId === appId ||
                (!p.dorisAppId &&
                  (p.name === name ||
                    (p.name.toLowerCase() === 'wingslite' &&
                      name === 'WingsLite(Android)')))),
          );
        return {
          appId,
          name,
          channel,
          spend: Number(row.spend),
          productId: product?.id,
        };
      });
  }

  syncProducts(): Promise<BiProduct[]> {
    const scope = personalScopeKey();
    const existing = this.syncPending.get(scope);
    if (existing) return existing;
    const pending = this.registerProducts().finally(() => {
      this.syncPending.delete(scope);
    });
    this.syncPending.set(scope, pending);
    return pending;
  }
  private async registerProducts(): Promise<BiProduct[]> {
    const products = await this.products();
    for (const found of products) {
      if (found.spend <= 0) continue;
      const existing = found.productId
        ? this.database.getProduct(found.productId)
        : undefined;
      if (existing) {
        if (!existing.dorisAppId)
          this.database.saveProduct({ ...existing, dorisAppId: found.appId });
        continue;
      }
      const product = await this.growth.createProduct(
        {
          name: found.name,
          channel: found.channel,
          targetMetric: 'd0_roas',
          dorisSource: DAILY,
        },
        'growth',
      );
      this.database.saveProduct({ ...product, dorisAppId: found.appId });
      found.productId = product.id;
    }
    return products;
  }
}
