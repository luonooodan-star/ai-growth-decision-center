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
  type DorisQueryResult,
  type DorisRow,
} from './doris-result-normalizer';

const FETCH_INTERVAL_MS = 60 * 60 * 1000;
const MCP_URL = process.env.DORIS_MCP_URL || 'http://192.168.3.102:8766/mcp';
const KEYCHAIN_SERVICE = 'ai-growth-doris-superset-mcp';

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
      const endDate = this.dateString(new Date());
      const start = new Date();
      start.setDate(start.getDate() - 8);
      const startDate = this.dateString(start);
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
          ? this.queryMetric({
              dataset: 'bi_ads.ads_paid_acquisition_daily',
              dimensions: [
                'report_date',
                'campaign_id',
                'campaign_name',
                'adgroup_id',
                'adgroup_name',
              ],
              start_date: deliveryDate,
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
            })
          : Promise.resolve({ rows: [], row_count: 0 }),
        cohortDate
          ? this.queryMetric({
              dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
              dimensions: [
                'install_date',
                'campaign_id',
                'campaign_name',
              ],
              start_date: cohortDate,
              end_date: cohortDate,
              filters_json: JSON.stringify(cohortFilters),
              metrics: ['cohort_spend', 'd0_roas'],
              limit: 1000,
            })
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
          : `抓取完成，已读取 ${rowsFetched} 行，发现 ${anomalyCount} 条新异常；未填写上下界的指标不参与判断`,
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
      const values: GrowthMetricValues = this.deliveryMetricValues(row);
      for (const key of ['cpi', 'ecpm', 'arpu'] as GrowthMetricKey[]) {
        if (
          await this.createAnomalyIfNeeded(
            product,
            key,
            values[key],
            values,
            row,
            latestDeliveryDate,
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
      if (
        await this.createAnomalyIfNeeded(
          product,
          'd0_roas',
          d0Roas,
          d0Roas === undefined ? {} : { d0_roas: d0Roas },
          row,
          latestCohortDate,
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
    if (this.hasRecentJudgment(product.id, key, campaignId, adsetId)) {
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

  private hasRecentJudgment(
    productId: string,
    metricKey: GrowthMetricKey,
    campaignId?: string,
    adsetId?: string,
  ): boolean {
    const cutoff: number = Date.now() - 24 * 60 * 60 * 1000;
    return this.database.listDecisionRecords(1000).some((record): boolean => {
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
    const structured: unknown = object?.structuredContent;
    if (structured) return normalizeDorisQueryResult(structured);
    const content: unknown = object?.content;
    if (Array.isArray(content)) {
      const textItem: unknown = content.find(
        (item: unknown): boolean =>
          typeof item === 'object' &&
          item !== null &&
          Reflect.get(item, 'type') === 'text',
      );
      const textObject: Record<string, unknown> | undefined =
        typeof textItem === 'object' && textItem !== null
          ? (textItem as Record<string, unknown>)
          : undefined;
      const text: unknown = textObject?.text;
      if (typeof text === 'string') return normalizeDorisQueryResult(text);
    }
    throw new Error('Doris MCP 未返回可解析的查询结果');
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
    const payload = contentType.includes('text/event-stream')
      ? JSON.parse(
          raw
            .split(/\r?\n/u)
            .find((line) => line.startsWith('data:'))
            ?.slice(5)
            .trim() || '{}',
        )
      : raw
        ? JSON.parse(raw)
        : null;
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
