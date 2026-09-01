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
  GrowthDeliveryMetricKey,
  GrowthDeliveryMetricValues,
  GrowthDiagnosticBreakdown,
  GrowthDiagnosticContext,
  GrowthJudgment,
  GrowthMetricDefinition,
  GrowthMetricKey,
  GrowthFetchHistoryResponse,
  GrowthFetchRun,
  GrowthMetricValues,
  GrowthProduct,
} from '@shared/api.interface';

import { LocalDatabaseService } from '@server/database/local-database.service';

import { GrowthDecisionService } from './growth-decision.service';
import { GrowthMavisAnalysisService } from './growth-mavis-analysis.service';
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
    private readonly growthMavisAnalysisService: GrowthMavisAnalysisService,
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

  async trigger(
    trigger: GrowthFetchRun['trigger'],
    productId?: string,
  ): Promise<GrowthFetchRun[]> {
    if (this.activeRun) {
      if (trigger === 'manual')
        throw new ConflictException('已有抓取任务正在运行');
      return this.activeRun;
    }
    this.activeRun = this.runProducts(trigger, productId);
    try {
      return await this.activeRun;
    } finally {
      this.activeRun = undefined;
    }
  }

  private async runProducts(
    trigger: GrowthFetchRun['trigger'],
    productId?: string,
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
      results.push(await this.fetchProduct(product, trigger));
    }
    return results;
  }

  private async fetchProduct(
    product: GrowthProduct,
    trigger: GrowthFetchRun['trigger'],
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
      start.setDate(start.getDate() - 8);
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
        earliestStoredDate && earliestStoredDate < defaultStartDate
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
          dimensions: ['report_date'],
          start_date: startDate,
          end_date: endDate,
          filters_json: JSON.stringify(filters),
          metrics: [
            'spend',
            'impressions',
            'adjust_installs',
            'adjust_revenue',
          ],
          limit: 30,
        }),
        this.queryMetric({
          dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
          dimensions: ['install_date'],
          start_date: startDate,
          end_date: endDate,
          filters_json: JSON.stringify(cohortFilters),
          metrics: ['cohort_spend', 'd0_roas'],
          limit: 30,
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

      const [delivery, cohort] = await Promise.all([
        deliveryDate
          ? this.queryMetricWithFallback(
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
      ]);

      const rowsFetched =
        Number(delivery.row_count || 0) + Number(cohort.row_count || 0);
      const deliveryRows: DorisRow[] = delivery.rows || [];
      const cohortRows: DorisRow[] = cohort.rows || [];
      const spendRows: number = deliveryRows.filter(
        (row: DorisRow): boolean => dorisNumber(row, 'spend') !== undefined,
      ).length;
      const latestMetricValues = this.calculateLatestMetrics(
        deliveryRows,
        cohortRows,
      );
      const updatedProduct: GrowthProduct = {
        ...product,
        lastSyncAt: new Date().toISOString(),
        latestMetricValues,
      };
      this.database.saveProduct(updatedProduct);
      const historicalBackfillCount: number =
        trigger === 'manual'
          ? await this.backfillHistoricalJudgments(
              updatedProduct,
              deliveryRows,
              cohortRows,
            )
          : 0;
      const anomalyCount: number = await this.detectAnomalies(
        updatedProduct,
        deliveryRows,
        cohortRows,
      );

      const spendMissing: boolean = deliveryRows.length > 0 && spendRows === 0;
      const isPartial: boolean = rowsFetched === 0 || spendMissing;
      Object.assign(run, {
        status: isPartial ? 'partial' : 'success',
        finishedAt: new Date().toISOString(),
        rowsFetched,
        anomalyCount,
        message: isPartial
          ? spendMissing
            ? `已读取 ${rowsFetched} 行，但 Doris 未返回可识别的消耗列；请核对 query_metric 的实际列名`
            : '连接成功，但当前时间窗口没有返回可用数据'
          : `抓取完成，已读取 ${rowsFetched} 行，发现 ${anomalyCount} 条新异常${
              trigger === 'manual'
                ? `，历史核对/回填 ${historicalBackfillCount} 条`
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
        );
      const currentValue: number | undefined =
        metricValues[judgment.targetMetric];
      const previousContext: string = JSON.stringify(
        judgment.diagnosticContext || null,
      );
      const nextContext: string = JSON.stringify(diagnosticContext);
      const needsAnalysisRefresh: boolean =
        previousContext !== nextContext ||
        judgment.aiAnalysis?.model.includes('Simulation') === true;
      const sourceRow: DorisRow = deliverySnapshot || matchedCohort || {};
      this.database.saveDecisionRecord({
        ...judgment,
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
      if (needsAnalysisRefresh) {
        await this.growthMavisAnalysisService.analyzeJudgment(
          judgment.id,
          'default',
          'manual',
        );
      }
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
    for (const row of latestDeliveryRows) {
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
        ? this.aggregateDeliveryRows(matchedDeliveryRows)
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
      const needsAnalysisRefresh: boolean =
        !existingJudgment.diagnosticContext ||
        existingJudgment.diagnosticContext.dataDate !==
          diagnosticContext.dataDate ||
        existingJudgment.diagnosticContext.availableFields.join(',') !==
          diagnosticContext.availableFields.join(',') ||
        existingJudgment.aiAnalysis?.model.includes('Simulation') === true;
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
      if (needsAnalysisRefresh) {
        void this.growthMavisAnalysisService
          .analyzeJudgment(existingJudgment.id, 'default', 'automatic')
          .catch((error: unknown): void => {
            this.logger.error(
              `异常 ${existingJudgment.id} 的补充分析失败：` +
                (error instanceof Error ? error.message : String(error)),
              error instanceof Error ? error.stack : undefined,
            );
          });
      }
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

    const judgment: GrowthJudgment =
      await this.growthDecisionService.ingestJudgment(
        {
          productId: product.id,
          anomalyType: `${metric.label} ${thresholdRelation}人工正常范围`,
          severity: thresholdGapPct >= 30 ? 'high' : 'medium',
          channel: product.channel,
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
    void this.growthMavisAnalysisService
      .analyzeJudgment(judgment.id, 'default', 'automatic')
      .catch((error: unknown): void => {
        this.logger.error(
          `异常 ${judgment.id} 的第一波分析失败：` +
            (error instanceof Error ? error.message : String(error)),
          error instanceof Error ? error.stack : undefined,
        );
      });
    return true;
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
    ];
    const availableFields: string[] = DELIVERY_METRIC_KEYS.filter(
      (key: GrowthDeliveryMetricKey): boolean => current[key] !== undefined,
    );
    const expectedFields: GrowthDeliveryMetricKey[] = DELIVERY_METRIC_KEYS;
    const availableDimensions: string[] = [
      dorisString(currentRow || {}, 'campaign_id') ? 'campaign' : '',
      dorisString(currentRow || {}, 'adgroup_id') ? 'adset' : '',
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
