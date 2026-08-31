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

const FETCH_INTERVAL_MS = 60 * 60 * 1000;
const MCP_URL = process.env.DORIS_MCP_URL || 'http://192.168.3.102:8766/mcp';
const KEYCHAIN_SERVICE = 'ai-growth-doris-superset-mcp';

interface DorisQueryResult {
  row_count?: number;
  rows?: Array<Record<string, unknown>>;
}

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
        this.logger.error(error instanceof Error ? error.message : String(error));
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
      if (trigger === 'manual') throw new ConflictException('已有抓取任务正在运行');
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
      ? [this.database.getProduct(productId)].filter(Boolean) as GrowthProduct[]
      : this.database.listProducts().filter((product) => product.status === 'active');
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
        app_name: product.name.toLowerCase() === 'wingslite' ? 'WingsLite(Android)' : product.name,
        media_source: product.channel.toLowerCase(),
        country_code: product.thresholds.markets
          ? String(product.thresholds.markets).split(',')
          : undefined,
      };

      const [delivery, cohort] = await Promise.all([
        this.queryMetric({
          dataset: 'bi_ads.ads_paid_acquisition_daily',
          dimensions: ['report_date', 'campaign_id', 'campaign_name', 'adgroup_id', 'adgroup_name'],
          start_date: startDate,
          end_date: endDate,
          filters_json: JSON.stringify(filters),
          metrics: ['spend', 'impressions', 'adjust_installs', 'adjust_revenue', 'cpi'],
          limit: 1000,
        }),
        this.queryMetric({
          dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
          dimensions: ['install_date', 'campaign_id', 'campaign_name'],
          start_date: startDate,
          end_date: endDate,
          filters_json: JSON.stringify({ ...filters, cohort_index: 0, observation_complete: true }),
          metrics: ['cohort_spend', 'd0_roas'],
          limit: 1000,
        }),
      ]);

      const rowsFetched = Number(delivery.row_count || 0) + Number(cohort.row_count || 0);
      const latestMetricValues = this.calculateLatestMetrics(delivery.rows || [], cohort.rows || []);
      const updatedProduct: GrowthProduct = {
        ...product,
        lastSyncAt: new Date().toISOString(),
        latestMetricValues,
      };
      this.database.saveProduct(updatedProduct);
      const anomalyCount: number = await this.detectAnomalies(
        updatedProduct,
        delivery.rows || [],
        cohort.rows || [],
      );

      const isPartial = rowsFetched === 0;
      Object.assign(run, {
        status: isPartial ? 'partial' : 'success',
        finishedAt: new Date().toISOString(),
        rowsFetched,
        anomalyCount,
        message: isPartial
          ? '连接成功，但当前时间窗口没有返回可用数据'
          : `抓取完成，已读取 ${rowsFetched} 行，发现 ${anomalyCount} 条新异常；未填写异常阈值的指标不参与判断`,
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
    deliveryRows: Array<Record<string, unknown>>,
    cohortRows: Array<Record<string, unknown>>,
  ): GrowthMetricValues {
    const latestDate = deliveryRows.reduce(
      (latest, row) => String(row.report_date || '') > latest ? String(row.report_date) : latest,
      '',
    );
    const latestRows = deliveryRows.filter((row) => String(row.report_date || '') === latestDate);
    const sum = (field: string): number => latestRows.reduce(
      (total, row) => total + (Number(row[field]) || 0),
      0,
    );
    const spend = sum('spend');
    const impressions = sum('impressions');
    const installs = sum('adjust_installs');
    const revenue = sum('adjust_revenue');
    const latestCohortDate = cohortRows.reduce(
      (latest, row) => String(row.install_date || '') > latest ? String(row.install_date) : latest,
      '',
    );
    const latestCohorts = cohortRows.filter((row) => String(row.install_date || '') === latestCohortDate);
    const cohortSpend = latestCohorts.reduce((total, row) => total + (Number(row.cohort_spend) || 0), 0);
    const weightedRoas = cohortSpend
      ? latestCohorts.reduce(
          (total, row) => total + (Number(row.d0_roas) || 0) * (Number(row.cohort_spend) || 0),
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
    deliveryRows: Array<Record<string, unknown>>,
    cohortRows: Array<Record<string, unknown>>,
  ): Promise<number> {
    let createdCount = 0;
    const latestDeliveryDate: string = this.latestDate(
      deliveryRows,
      'report_date',
    );
    const latestDeliveryRows: Array<Record<string, unknown>> =
      deliveryRows.filter(
        (row: Record<string, unknown>): boolean =>
          String(row.report_date || '') === latestDeliveryDate,
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
    const latestCohortRows: Array<Record<string, unknown>> = cohortRows.filter(
      (row: Record<string, unknown>): boolean =>
        String(row.install_date || '') === latestCohortDate,
    );
    for (const row of latestCohortRows) {
      const d0Roas: number | undefined = this.numeric(row.d0_roas);
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
    row: Record<string, unknown>,
    dataDate: string,
  ): Promise<boolean> {
    const metric: GrowthMetricDefinition | undefined = product.metrics.find(
      (item: GrowthMetricDefinition): boolean => item.key === key,
    );
    if (
      !metric ||
      metric.anomalyThreshold === undefined ||
      currentValue === undefined
    ) {
      return false;
    }
    const isAnomaly: boolean = metric.direction === 'lower'
      ? currentValue > metric.anomalyThreshold
      : currentValue < metric.anomalyThreshold;
    if (!isAnomaly) return false;

    const campaignId: string | undefined = this.optionalString(row.campaign_id);
    const adsetId: string | undefined = this.optionalString(row.adgroup_id);
    if (this.hasRecentJudgment(product.id, key, campaignId, adsetId)) {
      return false;
    }
    const baselineValue: number =
      metric.standardValue ?? metric.anomalyThreshold;
    const deviationPct: number | undefined = baselineValue
      ? Number((((currentValue - baselineValue) / baselineValue) * 100).toFixed(2))
      : undefined;
    const thresholdRelation: string = metric.direction === 'lower'
      ? '高于'
      : '低于';
    const entityDescription: string = [
      this.optionalString(row.campaign_name) || campaignId,
      this.optionalString(row.adgroup_name) || adsetId,
    ].filter(Boolean).join(' / ') || '产品级';
    const thresholdGapPct: number = metric.anomalyThreshold
      ? Math.abs(
          ((currentValue - metric.anomalyThreshold) /
            metric.anomalyThreshold) *
            100,
        )
      : 100;

    await this.growthDecisionService.ingestJudgment(
      {
        productId: product.id,
        anomalyType: `${metric.label} ${thresholdRelation}人工异常阈值`,
        severity: thresholdGapPct >= 30 ? 'high' : 'medium',
        channel: product.channel,
        campaignId,
        campaignName: this.optionalString(row.campaign_name),
        adsetId,
        adsetName: this.optionalString(row.adgroup_name),
        targetMetric: key,
        currentValue,
        baselineValue,
        deviationPct,
        metricValues,
        evidence:
          `${dataDate} ${entityDescription} 的 ${metric.label} 实际值 ` +
          `${this.formatMetricValue(metric, currentValue)}，${thresholdRelation}人工留档的异常阈值 ` +
          `${this.formatMetricValue(metric, metric.anomalyThreshold)}。`,
        rootCause:
          '指标已越过人工阈值；当前只确认异常条件成立，具体原因仍需结合投放、归因和产品链路继续分析。',
        confidence: 95,
        preliminaryJudgment:
          `按 ${product.name} 指标库规则，${metric.label} 异常条件成立，等待人工确认、待定或否决。`,
      },
      'hourly_doris_threshold_compare',
    );
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
      return judgment.productId === productId &&
        judgment.targetMetric === metricKey &&
        judgment.campaignId === campaignId &&
        judgment.adsetId === adsetId &&
        new Date(judgment.createdAt).getTime() >= cutoff;
    });
  }

  private deliveryMetricValues(
    row: Record<string, unknown>,
  ): GrowthMetricValues {
    const spend: number = this.numeric(row.spend) || 0;
    const impressions: number = this.numeric(row.impressions) || 0;
    const installs: number = this.numeric(row.adjust_installs) || 0;
    const revenue: number = this.numeric(row.adjust_revenue) || 0;
    const cpi: number | undefined = this.numeric(row.cpi) ||
      (installs ? spend / installs : undefined);
    return {
      ...(cpi !== undefined ? { cpi } : {}),
      ...(impressions ? { ecpm: (spend / impressions) * 1000 } : {}),
      ...(installs ? { arpu: revenue / installs } : {}),
    };
  }

  private latestDate(
    rows: Array<Record<string, unknown>>,
    field: string,
  ): string {
    return rows.reduce(
      (latest: string, row: Record<string, unknown>): string =>
        String(row[field] || '') > latest ? String(row[field]) : latest,
      '',
    );
  }

  private numeric(value: unknown): number | undefined {
    const parsed: number = Number(value);
    return value !== null && value !== '' && Number.isFinite(parsed)
      ? parsed
      : undefined;
  }

  private optionalString(value: unknown): string | undefined {
    const parsed: string = String(value || '').trim();
    return parsed || undefined;
  }

  private formatMetricValue(
    metric: GrowthMetricDefinition,
    value: number,
  ): string {
    if (metric.unit === 'percent') return `${(value * 100).toFixed(2)}%`;
    if (metric.unit === 'usd') return `$${value.toFixed(3)}`;
    return value.toFixed(3);
  }

  private async queryMetric(argumentsValue: Record<string, unknown>): Promise<DorisQueryResult> {
    const result = await this.callMcpTool('query_metric', argumentsValue);
    const text = result?.content?.find((item: { type?: string }) => item.type === 'text')?.text;
    if (!text) throw new Error('Doris MCP 未返回查询结果');
    return JSON.parse(text) as DorisQueryResult;
  }

  private async callMcpTool(name: string, argumentsValue: Record<string, unknown>): Promise<any> {
    const token = process.env.DORIS_SUPERSET_MCP_TOKEN || this.keychainToken();
    if (!token) throw new Error('Doris MCP Key 未配置，请重新运行公司 Mac setup.sh');
    let sessionId = '';
    const initialize = await this.postMcp(token, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ai-growth-decision-center', version: '1.0.0' } },
    });
    sessionId = initialize.sessionId;
    await this.postMcp(token, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sessionId);
    const response = await this.postMcp(token, {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: argumentsValue },
    }, sessionId);
    if (response.payload?.error) throw new Error(`Doris MCP：${response.payload.error.message || '查询失败'}`);
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
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Doris MCP HTTP ${response.status}: ${raw}`);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('text/event-stream')
      ? JSON.parse(raw.split(/\r?\n/u).find((line) => line.startsWith('data:'))?.slice(5).trim() || '{}')
      : raw ? JSON.parse(raw) : null;
    return { payload, sessionId: response.headers.get('mcp-session-id') || sessionId };
  }

  private keychainToken(): string {
    try {
      return execFileSync('security', ['find-generic-password', '-a', process.env.USER || '', '-s', KEYCHAIN_SERVICE, '-w'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  }

  private dateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
