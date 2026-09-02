import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import type {
  GrowthAdAccount,
  GrowthDeliveryMetricKey,
  GrowthDeliveryMetricValues,
  GrowthDataSnapshot,
  GrowthDiagnosticBreakdown,
  GrowthDiagnosticContext,
  GrowthDecisionCase,
  GrowthJudgment,
  GrowthMetricDefinition,
  GrowthMetricKey,
  GrowthFetchHistoryResponse,
  GrowthFetchRun,
  GrowthMetricValues,
  GrowthMonitoringSnapshot,
  GrowthProduct,
} from '@shared/api.interface';

import { LocalDatabaseService } from '@server/database/local-database.service';

import { GrowthDecisionService } from './growth-decision.service';
import {
  dorisNumber,
  dorisString,
  normalizeDorisQueryResult,
  parseMcpHttpPayload,
  type DorisQueryResult,
  type DorisRow,
} from './doris-result-normalizer';

const FETCH_INTERVAL_MS = 60 * 60 * 1000;
const MCP_URL = process.env.DORIS_MCP_URL || 'http://192.168.3.102:8766/mcp';
const KEYCHAIN_SERVICE = 'ai-growth-doris-superset-mcp';
const DELIVERY_METRIC_KEYS: GrowthDeliveryMetricKey[] = [
  'spend',
  'impressions',
  'media_clicks',
  'media_installs',
  'adjust_installs',
  'adjust_revenue',
  'cpi',
  'ecpm',
  'ctr',
  'ipm',
  'roas',
  'd0_roas',
];

@Injectable()
export class GrowthDataFetchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GrowthDataFetchService.name);
  private timer?: NodeJS.Timeout;
  private activeRun?: Promise<GrowthFetchRun[]>;
  private nextScheduledAt = new Date(Date.now() + FETCH_INTERVAL_MS);

  constructor(
    private readonly database: LocalDatabaseService,
    private readonly growthDecisionService: GrowthDecisionService,
  ) {}

  onModuleInit(): void {
    this.nextScheduledAt = new Date(Date.now() + FETCH_INTERVAL_MS);
    this.timer = setInterval(() => {
      this.nextScheduledAt = new Date(Date.now() + FETCH_INTERVAL_MS);
      void this.trigger('scheduled').catch((error: unknown) => {
        this.logger.error(
          error instanceof Error ? error.message : String(error),
        );
      });
    }, FETCH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  getHistory(productId?: string): GrowthFetchHistoryResponse {
    return {
      items: this.database.listFetchRuns(productId),
      scheduleMinutes: FETCH_INTERVAL_MS / 60_000,
      nextScheduledAt: this.nextScheduledAt.toISOString(),
    };
  }

  getDataHistory(productId: string): GrowthDataSnapshot[] {
    return this.database.listDataSnapshots(productId);
  }

  async trigger(
    trigger: GrowthFetchRun['trigger'],
    productId?: string,
    historyDays?: number,
  ): Promise<GrowthFetchRun[]> {
    if (this.activeRun) {
      if (trigger === 'manual')
        throw new ConflictException('已有抓取任务正在运行');
      return this.activeRun;
    }
    this.activeRun = this.runProducts(trigger, productId, historyDays);
    try {
      return await this.activeRun;
    } finally {
      this.activeRun = undefined;
    }
  }

  private async runProducts(
    trigger: GrowthFetchRun['trigger'],
    productId?: string,
    historyDays?: number,
  ): Promise<GrowthFetchRun[]> {
    const products = productId
      ? ([this.database.getProduct(productId)].filter(
          Boolean,
        ) as GrowthProduct[])
      : this.database
          .listProducts()
          .filter((product) => product.status === 'active');
    if (!products.length) throw new Error('没有可抓取的产品');

    const results: GrowthFetchRun[] = [];
    for (const product of products) {
      results.push(await this.fetchProduct(product, trigger, historyDays));
    }
    return results;
  }

  private async fetchProduct(
    product: GrowthProduct,
    trigger: GrowthFetchRun['trigger'],
    historyDays?: number,
  ): Promise<GrowthFetchRun> {
    const startedAt = new Date().toISOString();
    const run: GrowthFetchRun = {
      id: randomUUID(),
      productId: product.id,
      productName: product.name,
      trigger,
      status: 'running',
      startedAt,
      rowsFetched: 0,
      anomalyCount: 0,
      source: product.dorisSource || 'Doris MCP',
      message: '正在通过只读 Doris MCP 抓取',
    };
    this.database.saveFetchRun(run);

    try {
      const degradationNotes: string[] = [];
      const endDate = this.dateString(new Date());
      const start = new Date();
      const requestedHistoryDays: number =
        trigger === 'manual' && historyDays
          ? Math.min(30, Math.max(1, Math.round(historyDays)))
          : 8;
      // 包含今天在内恰好 N 天，避免“补近 7 天”实际查询 8 天。
      start.setDate(start.getDate() - (requestedHistoryDays - 1));
      const defaultStartDate: string = this.dateString(start);
      const historyCutoff = new Date();
      historyCutoff.setDate(historyCutoff.getDate() - 30);
      const historyCutoffDate: string = this.dateString(historyCutoff);
      const earliestStoredDate: string | undefined =
        trigger === 'manual'
          ? this.database
              .listDecisionRecords(5000)
              .filter(
                (record): record is GrowthJudgment =>
                  'preliminaryJudgment' in record &&
                  record.productId === product.id,
              )
              .map((judgment: GrowthJudgment): string | undefined =>
                this.judgmentDataDate(judgment),
              )
              .filter(
                (date: string | undefined): date is string =>
                  date !== undefined && date >= historyCutoffDate,
              )
              .sort()[0]
          : undefined;
      const startDate: string =
        !historyDays &&
        earliestStoredDate &&
        earliestStoredDate < defaultStartDate
          ? earliestStoredDate
          : defaultStartDate;
      const filters = {
        app_name:
          product.name.toLowerCase() === 'wingslite'
            ? 'WingsLite(Android)'
            : product.name,
        media_source: product.channel.toLowerCase(),
        country_code: product.thresholds.markets
          ? String(product.thresholds.markets).split(',')
          : undefined,
      };
      const cohortFilters = {
        ...filters,
        cohort_index: 0,
        observation_complete: true,
      };

      const [deliveryDates, cohortDates] = await Promise.all([
        this.queryMetric({
          dataset: 'bi_ads.ads_paid_acquisition_daily',
          dimensions: ['report_date', 'app_id'],
          start_date: startDate,
          end_date: endDate,
          filters_json: JSON.stringify(filters),
          metrics: [
            'spend',
            'impressions',
            'adjust_installs',
            'adjust_revenue',
          ],
          limit: 100,
        }),
        this.queryMetric({
          dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
          dimensions: ['install_date'],
          start_date: startDate,
          end_date: endDate,
          filters_json: JSON.stringify(cohortFilters),
          metrics: ['cohort_spend', 'd0_roas'],
          limit: 100,
        }),
      ]);
      const deliveryDate: string = this.latestDate(
        deliveryDates.rows || [],
        'report_date',
      );
      const cohortDate: string = this.latestDate(
        cohortDates.rows || [],
        'install_date',
      );
      const discoveredAppId: number | undefined =
        dorisNumber((deliveryDates.rows || [])[0] || {}, 'app_id') ??
        product.dorisAppId;
      const deliveryDataDates: string[] = Array.from(
        new Set(
          (deliveryDates.rows || [])
            .map(
              (row: DorisRow): string => dorisString(row, 'report_date') || '',
            )
            .filter(Boolean),
        ),
      ).sort();
      let accountProduct: GrowthProduct = product;
      let accountRowsFetched = 0;
      let newAccountCount = 0;
      let inactiveAccountCount = 0;
      if (discoveredAppId && product.channel.toLowerCase() === 'facebook') {
        try {
          const accountSync = await this.synchronizeFacebookAccounts(
            product,
            discoveredAppId,
            endDate,
          );
          accountProduct = accountSync.product;
          accountRowsFetched = accountSync.rowsFetched;
          newAccountCount = accountSync.newAccountCount;
          inactiveAccountCount = accountSync.inactiveAccountCount;
        } catch (error: unknown) {
          degradationNotes.push(
            `广告账户清单同步失败，已保留上次清单：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      const [delivery, cohort, adDelivery] = await Promise.all([
        deliveryDate
          ? trigger === 'manual' && Boolean(historyDays)
            ? this.queryDeliveryDetailsByDate(
                deliveryDataDates,
                filters,
                degradationNotes,
              )
            : this.queryMetricWithFallback(
                {
                  dataset: 'bi_ads.ads_paid_acquisition_daily',
                  dimensions: [
                    'report_date',
                    'country_code',
                    'campaign_id',
                    'campaign_name',
                    'adgroup_id',
                    'adgroup_name',
                  ],
                  start_date: startDate,
                  end_date: deliveryDate,
                  filters_json: JSON.stringify(filters),
                  metrics: [
                    'spend',
                    'impressions',
                    'media_clicks',
                    'media_installs',
                    'adjust_installs',
                    'adjust_revenue',
                    'cpi',
                    'ctr',
                    'ipm',
                    'roas',
                  ],
                  limit: 5000,
                },
                {
                  dataset: 'bi_ads.ads_paid_acquisition_daily',
                  dimensions: [
                    'report_date',
                    'campaign_id',
                    'campaign_name',
                    'adgroup_id',
                    'adgroup_name',
                  ],
                  start_date: startDate,
                  end_date: deliveryDate,
                  filters_json: JSON.stringify(filters),
                  metrics: [
                    'spend',
                    'impressions',
                    'adjust_installs',
                    'adjust_revenue',
                    'cpi',
                  ],
                  limit: 1000,
                },
                '投放明细',
                degradationNotes,
              )
          : Promise.resolve({ rows: [], row_count: 0 }),
        cohortDate
          ? this.queryMetricWithFallback(
              {
                dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
                dimensions: ['install_date', 'campaign_id', 'campaign_name'],
                start_date: startDate,
                end_date: cohortDate,
                filters_json: JSON.stringify(cohortFilters),
                metrics: [
                  'cohort_spend',
                  'metric_value',
                  'cumulative_metric_value',
                  'd0_roas',
                  'd7_roas',
                  'd30_roas',
                  'cohort_roas',
                ],
                limit: 5000,
              },
              {
                dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
                dimensions: ['install_date', 'campaign_id', 'campaign_name'],
                start_date: startDate,
                end_date: cohortDate,
                filters_json: JSON.stringify(cohortFilters),
                metrics: ['cohort_spend', 'd0_roas'],
                limit: 1000,
              },
              'cohort 明细',
              degradationNotes,
            )
          : Promise.resolve({ rows: [], row_count: 0 }),
        deliveryDate && discoveredAppId
          ? this.queryAdDeliveryDetails(
              discoveredAppId,
              startDate,
              deliveryDate,
              degradationNotes,
            )
          : Promise.resolve({ rows: [], row_count: 0 }),
      ]);

      const metricRowsFetched =
        Number(delivery.row_count || 0) +
        Number(cohort.row_count || 0) +
        Number(adDelivery.row_count || 0);
      const rowsFetched = metricRowsFetched + accountRowsFetched;
      const deliveryRows: DorisRow[] = delivery.rows || [];
      const cohortRows: DorisRow[] = cohort.rows || [];
      const adDeliveryRows: DorisRow[] = adDelivery.rows || [];
      const spendRows: number = deliveryRows.filter(
        (row: DorisRow): boolean => dorisNumber(row, 'spend') !== undefined,
      ).length;
      const latestMetricValues = this.calculateLatestMetrics(
        deliveryRows,
        cohortRows,
      );
      const updatedProduct: GrowthProduct = {
        ...accountProduct,
        dorisAppId: discoveredAppId || accountProduct.dorisAppId,
        lastSyncAt: new Date().toISOString(),
        latestMetricValues,
      };
      this.database.saveProduct(updatedProduct);
      const snapshotCount: number = this.saveDailySnapshots(
        updatedProduct,
        deliveryDates.rows || [],
        cohortDates.rows || [],
        deliveryRows,
      );
      const historicalBackfillCount: number =
        trigger === 'manual'
          ? await this.backfillHistoricalJudgments(
              updatedProduct,
              deliveryRows,
              cohortRows,
              adDeliveryRows,
            )
          : 0;
      const anomalyCount: number = await this.detectAnomalies(
        updatedProduct,
        deliveryRows,
        cohortRows,
        adDeliveryRows,
      );
      this.updateMonitoringSnapshots(
        updatedProduct,
        deliveryRows,
        cohortRows,
      );

      const spendMissing: boolean = deliveryRows.length > 0 && spendRows === 0;
      const isPartial: boolean = metricRowsFetched === 0 || spendMissing;
      Object.assign(run, {
        status: isPartial ? 'partial' : 'success',
        finishedAt: new Date().toISOString(),
        rowsFetched,
        anomalyCount,
        message: isPartial
          ? spendMissing
            ? `已读取 ${rowsFetched} 行，但 Doris 未返回可识别的消耗列；请核对 query_metric 的实际列名`
            : '连接成功，但当前时间窗口没有返回可用数据'
          : `抓取完成，已读取 ${rowsFetched} 行，动态同步 ${updatedProduct.adAccounts?.length || 0} 个广告账户` +
            `（新增 ${newAccountCount}，无近期投放 ${inactiveAccountCount}），发现 ${anomalyCount} 条新异常${
              trigger === 'manual'
                ? `，保存/更新 ${snapshotCount} 天历史快照，历史异常回填 ${historicalBackfillCount} 条`
                : ''
            }；未填写上下界的指标不参与判断${
              degradationNotes.length ? `；${degradationNotes.join('；')}` : ''
            }`,
      } satisfies Partial<GrowthFetchRun>);
    } catch (error: unknown) {
      Object.assign(run, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      } satisfies Partial<GrowthFetchRun>);
    }
    this.database.saveFetchRun(run);
    return run;
  }

  private async synchronizeFacebookAccounts(
    product: GrowthProduct,
    dorisAppId: number,
    endDate: string,
  ): Promise<{
    product: GrowthProduct;
    rowsFetched: number;
    newAccountCount: number;
    inactiveAccountCount: number;
  }> {
    const start: Date = new Date(`${endDate}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 29);
    const startDate: string = this.dateString(start);
    const recentStart: Date = new Date(`${endDate}T00:00:00Z`);
    recentStart.setUTCDate(recentStart.getUTCDate() - 2);
    const recentStartDate: string = this.dateString(recentStart);
    const [historyResult, recentResult]: [DorisQueryResult, DorisQueryResult] =
      await Promise.all([
        this.queryMetric({
          dataset: 'bi_dwd.dwd_facebook_campaign_daily',
          dimensions: ['advertiser_id'],
          start_date: startDate,
          end_date: endDate,
          filters_json: JSON.stringify({ app_id: dorisAppId }),
          metrics: ['spend', 'impressions'],
          limit: 1000,
        }),
        this.queryMetric({
          dataset: 'bi_dwd.dwd_facebook_campaign_daily',
          dimensions: ['advertiser_id'],
          start_date: recentStartDate,
          end_date: endDate,
          filters_json: JSON.stringify({ app_id: dorisAppId }),
          metrics: ['spend', 'impressions'],
          limit: 1000,
        }),
      ]);
    const rows: DorisRow[] = historyResult.rows || [];
    const recentlyActiveIds: Set<string> = new Set(
      (recentResult.rows || [])
        .map((row: DorisRow): string => dorisString(row, 'advertiser_id') || '')
        .filter(Boolean),
    );
    const now: string = new Date().toISOString();
    const existingAccounts: GrowthAdAccount[] =
      product.adAccounts ||
      product.accountIds.map(
        (id: string): GrowthAdAccount => ({
          id,
          activityStatus: 'unknown',
          spend30d: 0,
          impressions30d: 0,
          discoveredAt: product.lastSyncAt || now,
          updatedAt: product.lastSyncAt || now,
          source: 'legacy_config',
        }),
      );
    const existingById: Map<string, GrowthAdAccount> = new Map(
      existingAccounts.map(
        (account: GrowthAdAccount): [string, GrowthAdAccount] => [
          account.id,
          account,
        ],
      ),
    );
    const rowsByAccount: Map<string, DorisRow[]> = new Map();
    for (const row of rows) {
      const accountId: string | undefined = dorisString(row, 'advertiser_id');
      if (!accountId) continue;
      const accountRows: DorisRow[] = rowsByAccount.get(accountId) || [];
      accountRows.push(row);
      rowsByAccount.set(accountId, accountRows);
    }

    let newAccountCount = 0;
    const discoveredAccounts: GrowthAdAccount[] = Array.from(
      rowsByAccount.entries(),
    ).map(([accountId, accountRows]: [string, DorisRow[]]) => {
      const existing: GrowthAdAccount | undefined = existingById.get(accountId);
      if (!existing) newAccountCount += 1;
      const isRecentlyActive: boolean = recentlyActiveIds.has(accountId);
      const firstSeenDate: string = existing?.firstSeenDate || startDate;
      const lastSeenDate: string | undefined = isRecentlyActive
        ? endDate
        : existing?.lastSeenDate;
      return {
        id: accountId,
        activityStatus:
          !existing && isRecentlyActive
            ? 'new'
            : isRecentlyActive
              ? 'active'
              : 'inactive',
        firstSeenDate,
        lastSeenDate,
        spend30d: accountRows.reduce(
          (total: number, row: DorisRow): number =>
            total + (dorisNumber(row, 'spend') || 0),
          0,
        ),
        impressions30d: accountRows.reduce(
          (total: number, row: DorisRow): number =>
            total + (dorisNumber(row, 'impressions') || 0),
          0,
        ),
        discoveredAt: existing?.discoveredAt || now,
        updatedAt: now,
        source: 'doris_facebook_campaign_daily',
      } satisfies GrowthAdAccount;
    });
    const undiscoveredAccounts: GrowthAdAccount[] = existingAccounts
      .filter(
        (account: GrowthAdAccount): boolean => !rowsByAccount.has(account.id),
      )
      .map(
        (account: GrowthAdAccount): GrowthAdAccount => ({
          ...account,
          activityStatus: 'inactive',
          spend30d: 0,
          impressions30d: 0,
          updatedAt: now,
        }),
      );
    const adAccounts: GrowthAdAccount[] = [
      ...discoveredAccounts,
      ...undiscoveredAccounts,
    ].sort((left: GrowthAdAccount, right: GrowthAdAccount): number => {
      const priority: Record<GrowthAdAccount['activityStatus'], number> = {
        new: 0,
        active: 1,
        inactive: 2,
        unknown: 3,
      };
      return (
        priority[left.activityStatus] - priority[right.activityStatus] ||
        left.id.localeCompare(right.id)
      );
    });
    const inactiveAccountCount: number = adAccounts.filter(
      (account: GrowthAdAccount): boolean =>
        account.activityStatus === 'inactive',
    ).length;
    const accountIds: string[] = adAccounts.map(
      (account: GrowthAdAccount): string => account.id,
    );

    return {
      product: {
        ...product,
        dorisAppId,
        accountId: accountIds.join(','),
        accountIds,
        adAccounts,
        accountSyncAt: now,
      },
      rowsFetched:
        Number(historyResult.row_count || rows.length) +
        Number(recentResult.row_count || recentlyActiveIds.size),
      newAccountCount,
      inactiveAccountCount,
    };
  }

  private saveDailySnapshots(
    product: GrowthProduct,
    deliveryAggregateRows: DorisRow[],
    cohortAggregateRows: DorisRow[],
    deliveryDetailRows: DorisRow[],
  ): number {
    const dataDates: string[] = Array.from(
      new Set<string>([
        ...deliveryAggregateRows
          .map((row: DorisRow): string => dorisString(row, 'report_date') || '')
          .filter(Boolean),
        ...cohortAggregateRows
          .map(
            (row: DorisRow): string => dorisString(row, 'install_date') || '',
          )
          .filter(Boolean),
      ]),
    ).sort();
    const fetchedAt: string = new Date().toISOString();

    for (const dataDate of dataDates) {
      const dailyDeliveryAggregates: DorisRow[] = deliveryAggregateRows.filter(
        (row: DorisRow): boolean =>
          dorisString(row, 'report_date') === dataDate,
      );
      const dailyDeliveryDetails: DorisRow[] = deliveryDetailRows.filter(
        (row: DorisRow): boolean =>
          dorisString(row, 'report_date') === dataDate,
      );
      const dailyCohort: DorisRow[] = cohortAggregateRows.filter(
        (row: DorisRow): boolean =>
          dorisString(row, 'install_date') === dataDate,
      );
      // 日期聚合查询行数很小且不会被 Doris MCP 的明细 1000 行上限截断。
      // 明细仅用于补 Campaign/广告组数量，不能再作为每日指标的主数据源。
      const aggregate: DorisRow | undefined = dailyDeliveryAggregates.length
        ? this.aggregateDeliveryRows(dailyDeliveryAggregates)
        : undefined;
      const cohortSpend: number = dailyCohort.reduce(
        (total: number, row: DorisRow): number =>
          total + (dorisNumber(row, 'cohort_spend') || 0),
        0,
      );
      const weightedD0Roas: number | undefined = cohortSpend
        ? dailyCohort.reduce(
            (total: number, row: DorisRow): number =>
              total +
              (dorisNumber(row, 'd0_roas') || 0) *
                (dorisNumber(row, 'cohort_spend') || 0),
            0,
          ) / cohortSpend
        : undefined;
      const snapshot: GrowthDataSnapshot = {
        id: `${product.id}:${dataDate}`,
        productId: product.id,
        productName: product.name,
        dataDate,
        metrics: {
          ...this.deliveryDiagnosticValues(aggregate),
          ...(weightedD0Roas === undefined ? {} : { d0_roas: weightedD0Roas }),
        },
        campaignCount: new Set(
          dailyDeliveryDetails
            .map(
              (row: DorisRow): string =>
                dorisString(row, 'campaign_id') ||
                dorisString(row, 'campaign_name') ||
                '',
            )
            .filter(Boolean),
        ).size,
        adsetCount: new Set(
          dailyDeliveryDetails
            .map(
              (row: DorisRow): string =>
                dorisString(row, 'adgroup_id') ||
                dorisString(row, 'adgroup_name') ||
                '',
            )
            .filter(Boolean),
        ).size,
        sourceRows:
          dailyDeliveryAggregates.length +
          dailyDeliveryDetails.length +
          dailyCohort.length,
        fetchedAt,
      };
      this.database.saveDataSnapshot(snapshot);
    }
    return dataDates.length;
  }

  private calculateLatestMetrics(
    deliveryRows: DorisRow[],
    cohortRows: DorisRow[],
  ): GrowthMetricValues {
    const latestDate = deliveryRows.reduce(
      (latest: string, row: DorisRow): string => {
        const date: string = dorisString(row, 'report_date') || '';
        return date > latest ? date : latest;
      },
      '',
    );
    const latestRows: DorisRow[] = deliveryRows.filter(
      (row: DorisRow): boolean =>
        dorisString(row, 'report_date') === latestDate,
    );
    const sum = (field: string): number =>
      latestRows.reduce(
        (total: number, row: DorisRow): number =>
          total + (dorisNumber(row, field) || 0),
        0,
      );
    const spend = sum('spend');
    const impressions = sum('impressions');
    const installs = sum('adjust_installs');
    const revenue = sum('adjust_revenue');
    const latestCohortDate = cohortRows.reduce(
      (latest: string, row: DorisRow): string => {
        const date: string = dorisString(row, 'install_date') || '';
        return date > latest ? date : latest;
      },
      '',
    );
    const latestCohorts: DorisRow[] = cohortRows.filter(
      (row: DorisRow): boolean =>
        dorisString(row, 'install_date') === latestCohortDate,
    );
    const cohortSpend: number = latestCohorts.reduce(
      (total: number, row: DorisRow): number =>
        total + (dorisNumber(row, 'cohort_spend') || 0),
      0,
    );
    const weightedRoas = cohortSpend
      ? latestCohorts.reduce(
          (total: number, row: DorisRow): number =>
            total +
            (dorisNumber(row, 'd0_roas') || 0) *
              (dorisNumber(row, 'cohort_spend') || 0),
          0,
        ) / cohortSpend
      : undefined;
    return {
      ...(installs ? { cpi: spend / installs, arpu: revenue / installs } : {}),
      ...(impressions ? { ecpm: (spend / impressions) * 1000 } : {}),
      ...(weightedRoas !== undefined ? { d0_roas: weightedRoas } : {}),
    };
  }

  private async backfillHistoricalJudgments(
    product: GrowthProduct,
    deliveryRows: DorisRow[],
    cohortRows: DorisRow[],
    adDeliveryRows: DorisRow[],
  ): Promise<number> {
    const judgments: GrowthJudgment[] = this.database
      .listDecisionRecords(5000)
      .filter(
        (record): record is GrowthJudgment =>
          'preliminaryJudgment' in record && record.productId === product.id,
      );
    let updatedCount = 0;
    for (const judgment of judgments) {
      const dataDate: string | undefined = this.judgmentDataDate(judgment);
      if (!dataDate) continue;
      const matchedDeliveryRows: DorisRow[] = deliveryRows.filter(
        (row: DorisRow): boolean =>
          dorisString(row, 'report_date') === dataDate &&
          this.rowMatchesJudgment(row, judgment),
      );
      const matchedCohort: DorisRow | undefined = cohortRows.find(
        (row: DorisRow): boolean =>
          dorisString(row, 'install_date') === dataDate &&
          this.rowMatchesJudgment(row, judgment, false),
      );
      if (!matchedDeliveryRows.length && !matchedCohort) continue;

      const deliverySnapshot: DorisRow | undefined = matchedDeliveryRows.length
        ? this.aggregateDeliveryRows(matchedDeliveryRows)
        : undefined;
      const metricValues: GrowthMetricValues = {
        ...(deliverySnapshot
          ? this.deliveryMetricValues(deliverySnapshot)
          : judgment.metricValues),
        ...(matchedCohort && dorisNumber(matchedCohort, 'd0_roas') !== undefined
          ? { d0_roas: dorisNumber(matchedCohort, 'd0_roas') }
          : {}),
      };
      const diagnosticContext: GrowthDiagnosticContext =
        this.buildDiagnosticContext(
          deliveryRows,
          deliverySnapshot,
          dataDate,
          matchedCohort,
          matchedDeliveryRows,
          adDeliveryRows,
        );
      const currentValue: number | undefined =
        metricValues[judgment.targetMetric];
      const sourceRow: DorisRow = this.withAdAccount(
        deliverySnapshot || matchedCohort || {},
        adDeliveryRows,
        dataDate,
      );
      this.database.saveDecisionRecord({
        ...judgment,
        adAccountId:
          dorisString(sourceRow, 'advertiser_id') || judgment.adAccountId,
        campaignName:
          dorisString(sourceRow, 'campaign_name') || judgment.campaignName,
        adsetName: dorisString(sourceRow, 'adgroup_name') || judgment.adsetName,
        currentValue: currentValue ?? judgment.currentValue,
        metricValues: { ...judgment.metricValues, ...metricValues },
        diagnosticContext,
        spend:
          dorisNumber(sourceRow, 'spend') ??
          dorisNumber(sourceRow, 'cohort_spend') ??
          judgment.spend,
        evidence: judgment.evidence.includes('历史快照已回填')
          ? judgment.evidence
          : `${judgment.evidence}；${dataDate} 历史快照已回填。`,
      });
      updatedCount += 1;
    }
    return updatedCount;
  }

  private judgmentDataDate(judgment: GrowthJudgment): string | undefined {
    if (judgment.diagnosticContext?.dataDate) {
      return judgment.diagnosticContext.dataDate;
    }
    return judgment.evidence.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0];
  }

  private rowMatchesJudgment(
    row: DorisRow,
    judgment: GrowthJudgment,
    matchAdset = true,
  ): boolean {
    const campaignMatches: boolean = judgment.campaignId
      ? dorisString(row, 'campaign_id') === judgment.campaignId
      : judgment.campaignName
        ? dorisString(row, 'campaign_name') === judgment.campaignName
        : true;
    if (!campaignMatches || !matchAdset || !judgment.adsetId) {
      return campaignMatches;
    }
    return dorisString(row, 'adgroup_id') === judgment.adsetId;
  }

  private async detectAnomalies(
    product: GrowthProduct,
    deliveryRows: DorisRow[],
    cohortRows: DorisRow[],
    adDeliveryRows: DorisRow[],
  ): Promise<number> {
    let createdCount = 0;
    const latestDeliveryDate: string = this.latestDate(
      deliveryRows,
      'report_date',
    );
    const latestDeliveryRows: DorisRow[] = deliveryRows.filter(
      (row: DorisRow): boolean =>
        dorisString(row, 'report_date') === latestDeliveryDate,
    );
    for (const deliveryRow of latestDeliveryRows) {
      const row: DorisRow = this.withAdAccount(
        deliveryRow,
        adDeliveryRows,
        latestDeliveryDate,
      );
      const matchedCohort: DorisRow | undefined = this.findMatchedCohort(
        row,
        cohortRows,
      );
      const values: GrowthMetricValues = {
        ...this.deliveryMetricValues(row),
        ...(matchedCohort
          ? { d0_roas: dorisNumber(matchedCohort, 'd0_roas') }
          : {}),
      };
      const diagnosticContext: GrowthDiagnosticContext =
        this.buildDiagnosticContext(
          deliveryRows,
          row,
          latestDeliveryDate,
          matchedCohort,
          undefined,
          adDeliveryRows,
        );
      for (const key of ['cpi', 'ecpm', 'arpu'] as GrowthMetricKey[]) {
        if (
          await this.createAnomalyIfNeeded(
            product,
            key,
            values[key],
            values,
            row,
            latestDeliveryDate,
            diagnosticContext,
          )
        ) {
          createdCount += 1;
        }
      }
    }

    const latestCohortDate: string = this.latestDate(
      cohortRows,
      'install_date',
    );
    const latestCohortRows: DorisRow[] = cohortRows.filter(
      (row: DorisRow): boolean =>
        dorisString(row, 'install_date') === latestCohortDate,
    );
    for (const row of latestCohortRows) {
      const d0Roas: number | undefined = dorisNumber(row, 'd0_roas');
      const matchedDeliveryRows: DorisRow[] = this.matchDeliveryRows(
        row,
        latestDeliveryRows,
      );
      const deliverySnapshot: DorisRow | undefined = matchedDeliveryRows.length
        ? this.withAdAccount(
            this.aggregateDeliveryRows(matchedDeliveryRows),
            adDeliveryRows,
            latestDeliveryDate || latestCohortDate,
          )
        : undefined;
      const metricValues: GrowthMetricValues = {
        ...(deliverySnapshot
          ? this.deliveryMetricValues(deliverySnapshot)
          : {}),
        ...(d0Roas === undefined ? {} : { d0_roas: d0Roas }),
      };
      const diagnosticContext: GrowthDiagnosticContext =
        this.buildDiagnosticContext(
          deliveryRows,
          deliverySnapshot,
          latestDeliveryDate || latestCohortDate,
          row,
          matchedDeliveryRows,
          adDeliveryRows,
        );
      if (
        await this.createAnomalyIfNeeded(
          product,
          'd0_roas',
          d0Roas,
          metricValues,
          row,
          latestCohortDate,
          diagnosticContext,
        )
      ) {
        createdCount += 1;
      }
    }
    return createdCount;
  }

  private async createAnomalyIfNeeded(
    product: GrowthProduct,
    key: GrowthMetricKey,
    currentValue: number | undefined,
    metricValues: GrowthMetricValues,
    row: DorisRow,
    dataDate: string,
    diagnosticContext: GrowthDiagnosticContext,
  ): Promise<boolean> {
    const metric: GrowthMetricDefinition | undefined = product.metrics.find(
      (item: GrowthMetricDefinition): boolean => item.key === key,
    );
    if (
      !metric ||
      (metric.lowerBound === undefined && metric.upperBound === undefined) ||
      currentValue === undefined
    ) {
      return false;
    }
    const belowLower: boolean =
      metric.lowerBound !== undefined && currentValue < metric.lowerBound;
    const aboveUpper: boolean =
      metric.upperBound !== undefined && currentValue > metric.upperBound;
    const isAnomaly: boolean = belowLower || aboveUpper;
    if (!isAnomaly) return false;

    const campaignId: string | undefined = dorisString(row, 'campaign_id');
    const adsetId: string | undefined = dorisString(row, 'adgroup_id');
    const existingJudgment: GrowthJudgment | undefined =
      this.findRecentJudgment(product.id, key, campaignId, adsetId);
    if (existingJudgment) {
      this.database.saveDecisionRecord({
        ...existingJudgment,
        campaignName:
          dorisString(row, 'campaign_name') || existingJudgment.campaignName,
        adsetName:
          dorisString(row, 'adgroup_name') || existingJudgment.adsetName,
        currentValue,
        metricValues: {
          ...existingJudgment.metricValues,
          ...metricValues,
        },
        diagnosticContext,
        spend:
          dorisNumber(row, 'spend') ??
          dorisNumber(row, 'cohort_spend') ??
          existingJudgment.spend,
        evidence: existingJudgment.evidence.includes(dataDate)
          ? existingJudgment.evidence
          : `${existingJudgment.evidence}；${dataDate} 已补齐完整投放快照。`,
      });
      return false;
    }
    const baselineValue: number =
      metric.standardValue ??
      (belowLower ? metric.lowerBound! : metric.upperBound!);
    const deviationPct: number | undefined = baselineValue
      ? Number(
          (((currentValue - baselineValue) / baselineValue) * 100).toFixed(2),
        )
      : undefined;
    const thresholdRelation: string = belowLower ? '低于下界' : '高于上界';
    const triggeredBound: number = belowLower
      ? metric.lowerBound!
      : metric.upperBound!;
    const entityDescription: string =
      [
        dorisString(row, 'campaign_name') || campaignId,
        dorisString(row, 'adgroup_name') || adsetId,
      ]
        .filter(Boolean)
        .join(' / ') || '产品级';
    const thresholdGapPct: number = triggeredBound
      ? Math.abs(((currentValue - triggeredBound) / triggeredBound) * 100)
      : 100;

    await this.growthDecisionService.ingestJudgment(
      {
        productId: product.id,
        anomalyType: `${metric.label} ${thresholdRelation}人工正常范围`,
        severity: thresholdGapPct >= 30 ? 'high' : 'medium',
        channel: product.channel,
        adAccountId: dorisString(row, 'advertiser_id'),
        campaignId,
        campaignName: dorisString(row, 'campaign_name'),
        adsetId,
        adsetName: dorisString(row, 'adgroup_name'),
        targetMetric: key,
        currentValue,
        baselineValue,
        deviationPct,
        metricValues,
        diagnosticContext,
        spend: dorisNumber(row, 'spend') ?? dorisNumber(row, 'cohort_spend'),
        evidence:
          `${dataDate} ${entityDescription} 的 ${metric.label} 实际值 ` +
          `${this.formatMetricValue(metric, currentValue)}，${thresholdRelation} ` +
          `${this.formatMetricValue(metric, triggeredBound)}。`,
        rootCause:
          '指标已越过人工阈值；当前只确认异常条件成立，具体原因仍需结合投放、归因和产品链路继续分析。',
        confidence: 95,
        preliminaryJudgment: `按 ${product.name} 指标库规则，${metric.label} 异常条件成立，等待人工确认、待定或否决。`,
      },
      'hourly_doris_threshold_compare',
    );
    return true;
  }

  private updateMonitoringSnapshots(
    product: GrowthProduct,
    deliveryRows: DorisRow[],
    cohortRows: DorisRow[],
  ): void {
    const records: Array<GrowthDecisionCase | GrowthJudgment> = this.database
      .listDecisionRecords(5000)
      .filter(
        (record): record is GrowthDecisionCase | GrowthJudgment =>
          record.productId === product.id &&
          (record.status === 'judgment_observing' ||
            record.status === 'accepted' ||
            record.status === 'observing'),
      );
    const now: string = new Date().toISOString();
    const nowMs: number = new Date(now).getTime();
    const latestDeliveryDate: string = this.latestDate(
      deliveryRows,
      'report_date',
    );

    for (const record of records) {
      const metric: GrowthMetricDefinition | undefined = product.metrics.find(
        (item: GrowthMetricDefinition): boolean =>
          item.key === record.targetMetric,
      );
      if (
        !metric ||
        (metric.lowerBound === undefined && metric.upperBound === undefined)
      ) {
        continue;
      }
      const currentValue: number | undefined = this.latestExperimentValue(
        record,
        metric.key,
        deliveryRows,
        cohortRows,
      );
      if (currentValue === undefined) continue;

      const withinLower: boolean =
        metric.lowerBound === undefined || currentValue >= metric.lowerBound;
      const withinUpper: boolean =
        metric.upperBound === undefined || currentValue <= metric.upperBound;
      const isNormal: boolean = withinLower && withinUpper;
      const normalSince: string | undefined = isNormal
        ? this.monitoringNormalSince(record) || now
        : undefined;
      const recoveryReadyAt: string | undefined =
        isNormal &&
        normalSince &&
        nowMs - new Date(normalSince).getTime() >= 24 * 60 * 60 * 1000
          ? this.monitoringRecoveryReadyAt(record) || now
          : undefined;
      const becameReady: boolean = Boolean(
        recoveryReadyAt && !this.monitoringRecoveryReadyAt(record),
      );
      const latestMatches: DorisRow[] = deliveryRows.filter(
        (row: DorisRow): boolean =>
          dorisString(row, 'report_date') === latestDeliveryDate &&
          this.rowMatchesCase(row, record),
      );
      const metrics: GrowthDeliveryMetricValues = latestMatches.length
        ? this.deliveryDiagnosticValues(
            this.aggregateDeliveryRows(latestMatches),
          )
        : {};
      if (metric.key === 'd0_roas') metrics.d0_roas = currentValue;
      const previous: GrowthMonitoringSnapshot | undefined =
        this.database.listMonitoringSnapshots(record.id, 1)[0];
      const changesPct: GrowthDeliveryMetricValues =
        this.calculateMonitoringChanges(metrics, previous?.metrics || {});
      this.database.saveMonitoringSnapshot({
        id: randomUUID(),
        recordId: record.id,
        productId: product.id,
        subjectType:
          record.status === 'judgment_observing'
            ? 'judgment_observation'
            : 'experiment',
        observedAt: now,
        dataDate: latestDeliveryDate || now.slice(0, 10),
        campaignId: record.campaignId,
        campaignName: record.campaignName,
        adsetId: record.adsetId,
        adsetName: record.adsetName,
        metrics,
        previousMetrics: previous?.metrics || {},
        changesPct,
        isWithinNormalRange: isNormal,
        source: 'hourly_doris_monitoring',
      });
      const updatedRecord: GrowthDecisionCase | GrowthJudgment =
        record.status === 'judgment_observing'
          ? {
              ...record,
              latestObservedValue: currentValue,
              observationNormalSince: normalSince,
              observationRecoveryReadyAt: recoveryReadyAt,
            }
          : {
              ...record,
              latestObservedValue: currentValue,
              normalSince,
              recoveryReadyAt,
            };
      this.database.saveDecisionRecord(updatedRecord);
      if (becameReady) {
        this.database.appendActivity({
          caseId: record.id,
          action:
            record.status === 'judgment_observing'
              ? 'observation_recovery_ready'
              : 'experiment_recovery_ready',
          actor: 'hourly_doris_threshold_compare',
          detail: '目标指标已连续 24 小时处于产品指标库正常范围，可人工审核并移出观察',
          metadata: {
            source: 'doris_mcp',
            targetMetric: metric.key,
            latestObservedValue: String(currentValue),
          },
        });
      }
    }
  }

  private monitoringNormalSince(
    record: GrowthDecisionCase | GrowthJudgment,
  ): string | undefined {
    return 'preliminaryJudgment' in record
      ? record.observationNormalSince
      : record.normalSince;
  }

  private monitoringRecoveryReadyAt(
    record: GrowthDecisionCase | GrowthJudgment,
  ): string | undefined {
    return 'preliminaryJudgment' in record
      ? record.observationRecoveryReadyAt
      : record.recoveryReadyAt;
  }

  private calculateMonitoringChanges(
    current: GrowthDeliveryMetricValues,
    previous: GrowthDeliveryMetricValues,
  ): GrowthDeliveryMetricValues {
    const changes: GrowthDeliveryMetricValues = {};
    for (const key of DELIVERY_METRIC_KEYS) {
      const currentValue: number | undefined = current[key];
      const previousValue: number | undefined = previous[key];
      if (
        currentValue !== undefined &&
        previousValue !== undefined &&
        previousValue !== 0
      ) {
        changes[key] = Number(
          (((currentValue - previousValue) / previousValue) * 100).toFixed(2),
        );
      }
    }
    return changes;
  }

  private latestExperimentValue(
    experiment: GrowthDecisionCase | GrowthJudgment,
    metricKey: GrowthMetricKey,
    deliveryRows: DorisRow[],
    cohortRows: DorisRow[],
  ): number | undefined {
    if (metricKey === 'd0_roas') {
      const latestDate: string = this.latestDate(cohortRows, 'install_date');
      const matches: DorisRow[] = cohortRows.filter(
        (row: DorisRow): boolean =>
          dorisString(row, 'install_date') === latestDate &&
          this.rowMatchesCase(row, experiment, false),
      );
      const weightedRows: DorisRow[] = matches.filter(
        (row: DorisRow): boolean => dorisNumber(row, 'd0_roas') !== undefined,
      );
      const totalSpend: number = weightedRows.reduce(
        (total: number, row: DorisRow): number =>
          total + (dorisNumber(row, 'cohort_spend') || 0),
        0,
      );
      if (totalSpend) {
        return (
          weightedRows.reduce(
            (total: number, row: DorisRow): number =>
              total +
              (dorisNumber(row, 'd0_roas') || 0) *
                (dorisNumber(row, 'cohort_spend') || 0),
            0,
          ) / totalSpend
        );
      }
      return dorisNumber(weightedRows[0] || {}, 'd0_roas');
    }

    const latestDate: string = this.latestDate(deliveryRows, 'report_date');
    const matches: DorisRow[] = deliveryRows.filter(
      (row: DorisRow): boolean =>
        dorisString(row, 'report_date') === latestDate &&
        this.rowMatchesCase(row, experiment),
    );
    if (!matches.length) return undefined;
    return this.deliveryMetricValues(
      this.aggregateDeliveryRows(matches),
    )[metricKey];
  }

  private rowMatchesCase(
    row: DorisRow,
    experiment: GrowthDecisionCase | GrowthJudgment,
    matchAdset = true,
  ): boolean {
    const campaignMatches: boolean = experiment.campaignId
      ? dorisString(row, 'campaign_id') === experiment.campaignId
      : experiment.campaignName
        ? dorisString(row, 'campaign_name') === experiment.campaignName
        : true;
    if (!campaignMatches || !matchAdset) {
      return campaignMatches;
    }
    if (experiment.adsetId) {
      return dorisString(row, 'adgroup_id') === experiment.adsetId;
    }
    if (experiment.adsetName) {
      return dorisString(row, 'adgroup_name') === experiment.adsetName;
    }
    return campaignMatches;
  }

  private findRecentJudgment(
    productId: string,
    metricKey: GrowthMetricKey,
    campaignId?: string,
    adsetId?: string,
  ): GrowthJudgment | undefined {
    const cutoff: number = Date.now() - 24 * 60 * 60 * 1000;
    return this.database
      .listDecisionRecords(1000)
      .find((record): record is GrowthJudgment => {
        if (!('preliminaryJudgment' in record)) return false;
        const judgment: GrowthJudgment = record;
        return (
          judgment.productId === productId &&
          judgment.targetMetric === metricKey &&
          judgment.campaignId === campaignId &&
          judgment.adsetId === adsetId &&
          new Date(judgment.createdAt).getTime() >= cutoff
        );
      });
  }

  private deliveryMetricValues(row: DorisRow): GrowthMetricValues {
    const spend: number = dorisNumber(row, 'spend') || 0;
    const impressions: number = dorisNumber(row, 'impressions') || 0;
    const installs: number = dorisNumber(row, 'adjust_installs') || 0;
    const revenue: number = dorisNumber(row, 'adjust_revenue') || 0;
    const cpi: number | undefined =
      dorisNumber(row, 'cpi') || (installs ? spend / installs : undefined);
    return {
      ...(cpi !== undefined ? { cpi } : {}),
      ...(impressions ? { ecpm: (spend / impressions) * 1000 } : {}),
      ...(installs ? { arpu: revenue / installs } : {}),
    };
  }

  private deliveryDiagnosticValues(row?: DorisRow): GrowthDeliveryMetricValues {
    if (!row) return {};
    const spend: number = dorisNumber(row, 'spend') || 0;
    const impressions: number = dorisNumber(row, 'impressions') || 0;
    const mediaClicks: number = dorisNumber(row, 'media_clicks') || 0;
    const mediaInstalls: number = dorisNumber(row, 'media_installs') || 0;
    const adjustInstalls: number = dorisNumber(row, 'adjust_installs') || 0;
    const adjustRevenue: number = dorisNumber(row, 'adjust_revenue') || 0;
    return {
      spend,
      impressions,
      media_clicks: mediaClicks,
      media_installs: mediaInstalls,
      adjust_installs: adjustInstalls,
      adjust_revenue: adjustRevenue,
      ...(dorisNumber(row, 'cpi') !== undefined
        ? { cpi: dorisNumber(row, 'cpi') }
        : adjustInstalls
          ? { cpi: spend / adjustInstalls }
          : {}),
      ...(impressions ? { ecpm: (spend / impressions) * 1000 } : {}),
      ...(dorisNumber(row, 'ctr') !== undefined
        ? { ctr: dorisNumber(row, 'ctr') }
        : impressions
          ? { ctr: mediaClicks / impressions }
          : {}),
      ...(dorisNumber(row, 'ipm') !== undefined
        ? { ipm: dorisNumber(row, 'ipm') }
        : impressions
          ? { ipm: (mediaInstalls / impressions) * 1000 }
          : {}),
      ...(dorisNumber(row, 'roas') !== undefined
        ? { roas: dorisNumber(row, 'roas') }
        : spend
          ? { roas: adjustRevenue / spend }
          : {}),
    };
  }

  private findMatchedCohort(
    deliveryRow: DorisRow,
    cohortRows: DorisRow[],
  ): DorisRow | undefined {
    const latestDate: string = this.latestDate(cohortRows, 'install_date');
    const campaignId: string | undefined = dorisString(
      deliveryRow,
      'campaign_id',
    );
    const campaignName: string | undefined = dorisString(
      deliveryRow,
      'campaign_name',
    );
    return cohortRows.find(
      (row: DorisRow): boolean =>
        dorisString(row, 'install_date') === latestDate &&
        (campaignId
          ? dorisString(row, 'campaign_id') === campaignId
          : dorisString(row, 'campaign_name') === campaignName),
    );
  }

  private matchDeliveryRows(
    cohortRow: DorisRow,
    deliveryRows: DorisRow[],
  ): DorisRow[] {
    const campaignId: string | undefined = dorisString(
      cohortRow,
      'campaign_id',
    );
    const campaignName: string | undefined = dorisString(
      cohortRow,
      'campaign_name',
    );
    return deliveryRows.filter((row: DorisRow): boolean =>
      campaignId
        ? dorisString(row, 'campaign_id') === campaignId
        : dorisString(row, 'campaign_name') === campaignName,
    );
  }

  private aggregateDeliveryRows(rows: DorisRow[]): DorisRow {
    const first: DorisRow = rows[0] || {};
    const sum = (field: string): number =>
      rows.reduce(
        (total: number, row: DorisRow): number =>
          total + (dorisNumber(row, field) || 0),
        0,
      );
    const spend: number = sum('spend');
    const impressions: number = sum('impressions');
    const mediaClicks: number = sum('media_clicks');
    const mediaInstalls: number = sum('media_installs');
    const adjustInstalls: number = sum('adjust_installs');
    const adjustRevenue: number = sum('adjust_revenue');
    return {
      report_date: dorisString(first, 'report_date'),
      advertiser_id: rows.every(
        (row: DorisRow): boolean =>
          dorisString(row, 'advertiser_id') ===
          dorisString(first, 'advertiser_id'),
      )
        ? dorisString(first, 'advertiser_id')
        : undefined,
      country_code: rows.every(
        (row: DorisRow): boolean =>
          dorisString(row, 'country_code') ===
          dorisString(first, 'country_code'),
      )
        ? dorisString(first, 'country_code')
        : undefined,
      campaign_id: dorisString(first, 'campaign_id'),
      campaign_name: dorisString(first, 'campaign_name'),
      adgroup_id: rows.every(
        (row: DorisRow): boolean =>
          dorisString(row, 'adgroup_id') === dorisString(first, 'adgroup_id'),
      )
        ? dorisString(first, 'adgroup_id')
        : undefined,
      adgroup_name: rows.every(
        (row: DorisRow): boolean =>
          dorisString(row, 'adgroup_name') ===
          dorisString(first, 'adgroup_name'),
      )
        ? dorisString(first, 'adgroup_name')
        : undefined,
      spend,
      impressions,
      media_clicks: mediaClicks,
      media_installs: mediaInstalls,
      adjust_installs: adjustInstalls,
      adjust_revenue: adjustRevenue,
      cpi: adjustInstalls ? spend / adjustInstalls : undefined,
      ctr: impressions ? mediaClicks / impressions : undefined,
      ipm: impressions ? (mediaInstalls / impressions) * 1000 : undefined,
      roas: spend ? adjustRevenue / spend : undefined,
    };
  }

  private buildDiagnosticContext(
    deliveryRows: DorisRow[],
    currentRow: DorisRow | undefined,
    dataDate: string,
    cohortRow?: DorisRow,
    currentGroup?: DorisRow[],
    adDeliveryRows: DorisRow[] = [],
  ): GrowthDiagnosticContext {
    const current: GrowthDeliveryMetricValues = {
      ...this.deliveryDiagnosticValues(currentRow),
      ...(cohortRow && dorisNumber(cohortRow, 'd0_roas') !== undefined
        ? { d0_roas: dorisNumber(cohortRow, 'd0_roas') }
        : {}),
    };
    const entityRows: DorisRow[] = currentRow
      ? deliveryRows.filter(
          (row: DorisRow): boolean =>
            (dorisString(row, 'report_date') || '') < dataDate &&
            this.sameDeliveryEntity(currentRow, row),
        )
      : [];
    const rowsByDate: Map<string, DorisRow[]> = new Map<string, DorisRow[]>();
    for (const row of entityRows) {
      const date: string = dorisString(row, 'report_date') || '';
      if (!date) continue;
      rowsByDate.set(date, [...(rowsByDate.get(date) || []), row]);
    }
    const previousSnapshots: GrowthDeliveryMetricValues[] = Array.from(
      rowsByDate.values(),
    ).map(
      (rows: DorisRow[]): GrowthDeliveryMetricValues =>
        this.deliveryDiagnosticValues(this.aggregateDeliveryRows(rows)),
    );
    const previousAverage: GrowthDeliveryMetricValues =
      this.averageDiagnosticMetrics(previousSnapshots);
    const changesPct: GrowthDeliveryMetricValues = {};
    for (const key of DELIVERY_METRIC_KEYS) {
      const currentValue: number | undefined = current[key];
      const previousValue: number | undefined = previousAverage[key];
      if (
        currentValue !== undefined &&
        previousValue !== undefined &&
        previousValue !== 0
      ) {
        changesPct[key] = Number(
          (((currentValue - previousValue) / previousValue) * 100).toFixed(2),
        );
      }
    }
    const latestGroup: DorisRow[] =
      currentGroup ||
      (currentRow
        ? deliveryRows.filter(
            (row: DorisRow): boolean =>
              dorisString(row, 'report_date') === dataDate &&
              this.sameCampaign(currentRow, row),
          )
        : []);
    const breakdowns: GrowthDiagnosticBreakdown[] = [
      ...this.buildBreakdowns(
        latestGroup,
        'adset',
        'adgroup_id',
        'adgroup_name',
      ),
      ...this.buildBreakdowns(
        latestGroup,
        'country',
        'country_code',
        'country_code',
      ),
      ...this.buildAdBreakdowns(adDeliveryRows, currentRow, dataDate),
      ...this.buildTaggedBreakdowns(adDeliveryRows, currentRow, dataDate),
    ];
    const availableFields: string[] = DELIVERY_METRIC_KEYS.filter(
      (key: GrowthDeliveryMetricKey): boolean => current[key] !== undefined,
    );
    const expectedFields: GrowthDeliveryMetricKey[] = DELIVERY_METRIC_KEYS;
    const availableDimensions: string[] = [
      dorisString(currentRow || {}, 'campaign_id') ? 'campaign' : '',
      dorisString(currentRow || {}, 'adgroup_id') ? 'adset' : '',
      breakdowns.some(
        (item: GrowthDiagnosticBreakdown): boolean => item.dimension === 'ad',
      )
        ? 'ad'
        : '',
      dorisString(currentRow || {}, 'country_code') ||
      breakdowns.some(
        (item: GrowthDiagnosticBreakdown): boolean =>
          item.dimension === 'country',
      )
        ? 'country'
        : '',
    ].filter(Boolean);
    const desiredDimensions: string[] = [
      'campaign',
      'adset',
      'ad',
      'country',
      'placement',
      'age',
      'gender',
      'audience',
    ];
    return {
      dataDate,
      comparisonDays: previousSnapshots.length,
      current,
      previousAverage,
      changesPct,
      breakdowns,
      availableFields,
      missingFields: expectedFields.filter(
        (key: GrowthDeliveryMetricKey): boolean => current[key] === undefined,
      ),
      availableDimensions,
      missingDimensions: desiredDimensions.filter(
        (dimension: string): boolean =>
          !availableDimensions.includes(dimension),
      ),
    };
  }

  private sameCampaign(left: DorisRow, right: DorisRow): boolean {
    const campaignId: string | undefined = dorisString(left, 'campaign_id');
    return campaignId
      ? dorisString(right, 'campaign_id') === campaignId
      : dorisString(right, 'campaign_name') ===
          dorisString(left, 'campaign_name');
  }

  private sameDeliveryEntity(left: DorisRow, right: DorisRow): boolean {
    if (!this.sameCampaign(left, right)) return false;
    const adsetId: string | undefined = dorisString(left, 'adgroup_id');
    const country: string | undefined = dorisString(left, 'country_code');
    return (
      (!adsetId || dorisString(right, 'adgroup_id') === adsetId) &&
      (!country || dorisString(right, 'country_code') === country)
    );
  }

  private withAdAccount(
    row: DorisRow,
    adDeliveryRows: DorisRow[],
    dataDate: string,
  ): DorisRow {
    if (dorisString(row, 'advertiser_id')) return row;
    const adsetId: string | undefined = dorisString(row, 'adgroup_id');
    const matched: DorisRow | undefined = adDeliveryRows.find(
      (candidate: DorisRow): boolean =>
        dorisString(candidate, 'report_date') === dataDate &&
        this.sameCampaign(row, candidate) &&
        (!adsetId || dorisString(candidate, 'adgroup_id') === adsetId),
    );
    return matched
      ? { ...row, advertiser_id: dorisString(matched, 'advertiser_id') }
      : row;
  }

  private averageDiagnosticMetrics(
    snapshots: GrowthDeliveryMetricValues[],
  ): GrowthDeliveryMetricValues {
    const result: GrowthDeliveryMetricValues = {};
    for (const key of DELIVERY_METRIC_KEYS) {
      const values: number[] = snapshots
        .map(
          (snapshot: GrowthDeliveryMetricValues): number | undefined =>
            snapshot[key],
        )
        .filter((value: number | undefined): value is number =>
          Number.isFinite(value),
        );
      if (values.length) {
        result[key] =
          values.reduce(
            (total: number, value: number): number => total + value,
            0,
          ) / values.length;
      }
    }
    return result;
  }

  private buildBreakdowns(
    rows: DorisRow[],
    dimension: GrowthDiagnosticBreakdown['dimension'],
    valueField: string,
    labelField: string,
  ): GrowthDiagnosticBreakdown[] {
    const groups: Map<string, DorisRow[]> = new Map<string, DorisRow[]>();
    for (const row of rows) {
      const value: string | undefined = dorisString(row, valueField);
      if (!value) continue;
      groups.set(value, [...(groups.get(value) || []), row]);
    }
    return Array.from(groups.entries())
      .map(
        ([value, groupRows]: [
          string,
          DorisRow[],
        ]): GrowthDiagnosticBreakdown => ({
          dimension,
          value,
          label: dorisString(groupRows[0] || {}, labelField) || value,
          metrics: this.deliveryDiagnosticValues(
            this.aggregateDeliveryRows(groupRows),
          ),
        }),
      )
      .sort(
        (left: GrowthDiagnosticBreakdown, right: GrowthDiagnosticBreakdown) =>
          (right.metrics.spend || 0) - (left.metrics.spend || 0),
      )
      .slice(0, 12);
  }

  private buildAdBreakdowns(
    rows: DorisRow[],
    currentRow: DorisRow | undefined,
    dataDate: string,
  ): GrowthDiagnosticBreakdown[] {
    if (!currentRow) return [];
    const adsetId: string | undefined = dorisString(
      currentRow,
      'adgroup_id',
    );
    const normalizedRows: DorisRow[] = rows
      .filter(
        (row: DorisRow): boolean =>
          dorisString(row, 'report_date') === dataDate &&
          this.sameCampaign(currentRow, row) &&
          (!adsetId || dorisString(row, 'adgroup_id') === adsetId),
      )
      .map(
        (row: DorisRow): DorisRow => ({
          ...row,
          media_clicks:
            dorisNumber(row, 'media_clicks') ?? dorisNumber(row, 'clicks'),
          media_installs:
            dorisNumber(row, 'media_installs') ?? dorisNumber(row, 'installs'),
        }),
      );
    return this.buildBreakdowns(
      normalizedRows,
      'ad',
      'ad_id',
      'ad_name',
    );
  }

  private buildTaggedBreakdowns(
    rows: DorisRow[],
    currentRow: DorisRow | undefined,
    dataDate: string,
  ): GrowthDiagnosticBreakdown[] {
    if (!currentRow) return [];
    const adsetId: string | undefined = dorisString(
      currentRow,
      'adgroup_id',
    );
    const dimensions: GrowthDiagnosticBreakdown['dimension'][] = [
      'placement',
      'age',
      'gender',
      'audience',
    ];
    return dimensions.flatMap(
      (
        dimension: GrowthDiagnosticBreakdown['dimension'],
      ): GrowthDiagnosticBreakdown[] => {
        const matchedRows: DorisRow[] = rows
          .filter(
            (row: DorisRow): boolean =>
              dorisString(row, '__diagnostic_dimension') === dimension &&
              dorisString(row, 'report_date') === dataDate &&
              this.sameCampaign(currentRow, row) &&
              (!adsetId || dorisString(row, 'adgroup_id') === adsetId),
          )
          .map(
            (row: DorisRow): DorisRow => ({
              ...row,
              media_clicks:
                dorisNumber(row, 'media_clicks') ?? dorisNumber(row, 'clicks'),
              media_installs:
                dorisNumber(row, 'media_installs') ??
                dorisNumber(row, 'installs'),
            }),
          );
        return this.buildBreakdowns(
          matchedRows,
          dimension,
          '__diagnostic_value',
          '__diagnostic_label',
        );
      },
    );
  }

  private latestDate(rows: DorisRow[], field: string): string {
    return rows.reduce((latest: string, row: DorisRow): string => {
      const value: string = dorisString(row, field) || '';
      return value > latest ? value : latest;
    }, '');
  }

  private formatMetricValue(
    metric: GrowthMetricDefinition,
    value: number,
  ): string {
    if (metric.unit === 'percent') return `${(value * 100).toFixed(2)}%`;
    if (metric.unit === 'usd') return `$${value.toFixed(3)}`;
    return value.toFixed(3);
  }

  private async queryDeliveryDetailsByDate(
    dates: string[],
    filters: Record<string, unknown>,
    degradationNotes: string[],
  ): Promise<DorisQueryResult> {
    const rows: DorisRow[] = [];
    let rowCount = 0;
    // 按天拆分，规避 Doris MCP 对跨日明细查询的行数截断。
    for (const dataDate of dates) {
      const result: DorisQueryResult = await this.queryMetricWithFallback(
        {
          dataset: 'bi_ads.ads_paid_acquisition_daily',
          dimensions: [
            'report_date',
            'country_code',
            'campaign_id',
            'campaign_name',
            'adgroup_id',
            'adgroup_name',
          ],
          start_date: dataDate,
          end_date: dataDate,
          filters_json: JSON.stringify(filters),
          metrics: [
            'spend',
            'impressions',
            'media_clicks',
            'media_installs',
            'adjust_installs',
            'adjust_revenue',
            'cpi',
            'ctr',
            'ipm',
            'roas',
          ],
          limit: 1000,
        },
        {
          dataset: 'bi_ads.ads_paid_acquisition_daily',
          dimensions: [
            'report_date',
            'campaign_id',
            'campaign_name',
            'adgroup_id',
            'adgroup_name',
          ],
          start_date: dataDate,
          end_date: dataDate,
          filters_json: JSON.stringify(filters),
          metrics: [
            'spend',
            'impressions',
            'adjust_installs',
            'adjust_revenue',
            'cpi',
          ],
          limit: 1000,
        },
        `${dataDate} 投放明细`,
        degradationNotes,
      );
      rows.push(...(result.rows || []));
      rowCount += Number(result.row_count || result.rows?.length || 0);
    }
    return { rows, row_count: rowCount };
  }

  private async queryAdDeliveryDetails(
    appId: number,
    startDate: string,
    endDate: string,
    degradationNotes: string[],
  ): Promise<DorisQueryResult> {
    const filters: Record<string, unknown> = { app_id: appId };
    const breakdownPromises: Promise<DorisRow[]>[] = [
      this.queryOptionalFacebookBreakdown(
        'placement',
        'bi_dwd.dwd_facebook_ad_daily',
        [
          ['publisher_platform', 'platform_position'],
          ['placement'],
        ],
        filters,
        startDate,
        endDate,
        degradationNotes,
      ),
      this.queryOptionalFacebookBreakdown(
        'age',
        'bi_dwd.dwd_facebook_ad_daily',
        [['age']],
        filters,
        startDate,
        endDate,
        degradationNotes,
      ),
      this.queryOptionalFacebookBreakdown(
        'gender',
        'bi_dwd.dwd_facebook_ad_daily',
        [['gender']],
        filters,
        startDate,
        endDate,
        degradationNotes,
      ),
      this.queryOptionalFacebookBreakdown(
        'audience',
        'bi_dwd.dwd_facebook_adgroup_daily',
        [
          ['audience_id', 'audience_name'],
          ['custom_audience_id', 'custom_audience_name'],
          ['targeting_id', 'targeting_name'],
        ],
        filters,
        startDate,
        endDate,
        degradationNotes,
      ),
    ];
    try {
      const adResult: DorisQueryResult = await this.queryMetricWithFallback(
        {
          dataset: 'bi_dwd.dwd_facebook_ad_daily',
          dimensions: [
            'report_date',
            'advertiser_id',
            'campaign_id',
            'campaign_name',
            'adgroup_id',
            'adgroup_name',
            'ad_id',
            'ad_name',
            'creative_id',
            'creative_name',
          ],
          start_date: startDate,
          end_date: endDate,
          filters_json: JSON.stringify(filters),
          metrics: ['spend', 'impressions', 'clicks', 'installs'],
          limit: 5000,
        },
        {
          dataset: 'bi_dwd.dwd_facebook_ad_daily',
          dimensions: [
            'report_date',
            'advertiser_id',
            'campaign_id',
            'campaign_name',
            'adgroup_id',
            'adgroup_name',
            'ad_id',
            'ad_name',
          ],
          start_date: startDate,
          end_date: endDate,
          filters_json: JSON.stringify(filters),
          metrics: ['spend', 'impressions'],
          limit: 5000,
        },
        '广告级投放明细',
        degradationNotes,
      );
      const breakdownRows: DorisRow[] = (
        await Promise.all(breakdownPromises)
      ).flat();
      return {
        rows: [...(adResult.rows || []), ...breakdownRows],
        row_count:
          Number(adResult.row_count || adResult.rows?.length || 0) +
          breakdownRows.length,
      };
    } catch (error: unknown) {
      const breakdownRows: DorisRow[] = (
        await Promise.all(breakdownPromises)
      ).flat();
      degradationNotes.push(
        `广告级监控暂不可用：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        rows: breakdownRows,
        row_count: breakdownRows.length,
      };
    }
  }

  private async queryOptionalFacebookBreakdown(
    dimension: 'placement' | 'age' | 'gender' | 'audience',
    dataset: string,
    fieldCandidates: string[][],
    filters: Record<string, unknown>,
    startDate: string,
    endDate: string,
    degradationNotes: string[],
  ): Promise<DorisRow[]> {
    const entityDimensions: string[] = [
      'report_date',
      'advertiser_id',
      'campaign_id',
      'campaign_name',
      'adgroup_id',
      'adgroup_name',
    ];
    const errors: string[] = [];
    for (const fields of fieldCandidates) {
      try {
        const result: DorisQueryResult = await this.queryMetricWithFallback(
          {
            dataset,
            dimensions: [...entityDimensions, ...fields],
            start_date: startDate,
            end_date: endDate,
            filters_json: JSON.stringify(filters),
            metrics: ['spend', 'impressions', 'clicks', 'installs'],
            limit: 5000,
          },
          {
            dataset,
            dimensions: [...entityDimensions, ...fields],
            start_date: startDate,
            end_date: endDate,
            filters_json: JSON.stringify(filters),
            metrics: ['spend', 'impressions'],
            limit: 5000,
          },
          `${dimension} 拆分`,
          [],
        );
        const rows: DorisRow[] = result.rows || [];
        if (!rows.length) continue;
        return rows
          .map((row: DorisRow): DorisRow | undefined => {
            const values: string[] = fields
              .map((field: string): string => dorisString(row, field) || '')
              .filter(Boolean);
            if (!values.length) return undefined;
            return {
              ...row,
              __diagnostic_dimension: dimension,
              __diagnostic_value: values.join(' / '),
              __diagnostic_label: values.join(' · '),
            };
          })
          .filter((row: DorisRow | undefined): row is DorisRow => Boolean(row));
      } catch (error: unknown) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    degradationNotes.push(
      `Doris 未返回 ${dimension} 拆分${
        errors.length ? `（${errors[errors.length - 1]}）` : ''
      }`,
    );
    return [];
  }

  private async queryMetric(
    argumentsValue: Record<string, unknown>,
  ): Promise<DorisQueryResult> {
    const result: unknown = await this.callMcpTool(
      'query_metric',
      argumentsValue,
    );
    const object: Record<string, unknown> | undefined =
      typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>)
        : undefined;
    const content: unknown = object?.content;
    const textItem: unknown = Array.isArray(content)
      ? content.find(
          (item: unknown): boolean =>
            typeof item === 'object' &&
            item !== null &&
            Reflect.get(item, 'type') === 'text',
        )
      : undefined;
    const textObject: Record<string, unknown> | undefined =
      typeof textItem === 'object' && textItem !== null
        ? (textItem as Record<string, unknown>)
        : undefined;
    const text: unknown = textObject?.text;
    if (object?.isError === true) {
      throw new Error(
        `Doris MCP 查询失败：${
          typeof text === 'string' ? text.slice(0, 500) : '未知错误'
        }`,
      );
    }
    const structured: unknown = object?.structuredContent;
    if (structured) return normalizeDorisQueryResult(structured);
    if (Array.isArray(content)) {
      if (typeof text === 'string') return normalizeDorisQueryResult(text);
    }
    throw new Error('Doris MCP 未返回可解析的查询结果');
  }

  private async queryMetricWithFallback(
    primaryArguments: Record<string, unknown>,
    fallbackArguments: Record<string, unknown>,
    label: string,
    degradationNotes: string[],
  ): Promise<DorisQueryResult> {
    try {
      return await this.queryMetric(primaryArguments);
    } catch (primaryError: unknown) {
      const detail: string =
        primaryError instanceof Error
          ? primaryError.message
          : String(primaryError);
      this.logger.warn(`${label}完整查询失败，改用基础字段：${detail}`);
      try {
        const result: DorisQueryResult =
          await this.queryMetric(fallbackArguments);
        degradationNotes.push(
          `${label}的可选指标/维度未被当前 Doris 接口接受，已自动改用基础数据`,
        );
        return result;
      } catch (fallbackError: unknown) {
        const fallbackDetail: string =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        throw new Error(
          `${label}查询失败；完整查询：${detail}；基础查询：${fallbackDetail}`,
        );
      }
    }
  }

  private async callMcpTool(
    name: string,
    argumentsValue: Record<string, unknown>,
  ): Promise<any> {
    const token = process.env.DORIS_SUPERSET_MCP_TOKEN || this.keychainToken();
    if (!token)
      throw new Error('Doris MCP Key 未配置，请重新运行公司 Mac setup.sh');
    let sessionId = '';
    const initialize = await this.postMcp(token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'ai-growth-decision-center', version: '1.0.0' },
      },
    });
    sessionId = initialize.sessionId;
    await this.postMcp(
      token,
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      sessionId,
    );
    const response = await this.postMcp(
      token,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name, arguments: argumentsValue },
      },
      sessionId,
    );
    if (response.payload?.error)
      throw new Error(
        `Doris MCP：${response.payload.error.message || '查询失败'}`,
      );
    return response.payload?.result;
  }

  private async postMcp(
    token: string,
    body: Record<string, unknown>,
    sessionId = '',
  ): Promise<{ payload: any; sessionId: string }> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const raw = await response.text();
    if (!response.ok)
      throw new Error(`Doris MCP HTTP ${response.status}: ${raw}`);
    const contentType = response.headers.get('content-type') || '';
    const payload: unknown = parseMcpHttpPayload(raw, contentType);
    return {
      payload,
      sessionId: response.headers.get('mcp-session-id') || sessionId,
    };
  }

  private keychainToken(): string {
    try {
      return execFileSync(
        'security',
        [
          'find-generic-password',
          '-a',
          process.env.USER || '',
          '-s',
          KEYCHAIN_SERVICE,
          '-w',
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
    } catch {
      return '';
    }
  }

  private dateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
