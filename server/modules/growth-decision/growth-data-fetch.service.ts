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
  GrowthFetchHistoryResponse,
  GrowthFetchRun,
  GrowthMetricValues,
  GrowthProduct,
} from '@shared/api.interface';

import { LocalDatabaseService } from '@server/database/local-database.service';

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

  constructor(private readonly database: LocalDatabaseService) {}

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
      this.database.saveProduct({
        ...product,
        lastSyncAt: new Date().toISOString(),
        latestMetricValues,
      });

      const isPartial = rowsFetched === 0;
      Object.assign(run, {
        status: isPartial ? 'partial' : 'success',
        finishedAt: new Date().toISOString(),
        rowsFetched,
        message: isPartial
          ? '连接成功，但当前时间窗口没有返回可用数据'
          : `抓取完成，已读取 ${rowsFetched} 行；未配置阈值的指标不会自动判异常`,
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
