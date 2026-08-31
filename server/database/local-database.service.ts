import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  GrowthDecisionCase,
  GrowthDecisionActivity,
  GrowthFetchRun,
  GrowthJudgment,
  GrowthMetricDefinition,
  GrowthProduct,
} from '@shared/api.interface';

type DecisionRecord = GrowthDecisionCase | GrowthJudgment;

interface DecisionActivityInput {
  caseId: string;
  action: string;
  actor: string;
  detail: string;
  metadata: Record<string, string>;
}

const WINGSLITE_PRODUCT_ID = '579150cc-4ebe-4f27-891d-2dbc375d7889';

const DEFAULT_GROWTH_METRICS: GrowthMetricDefinition[] = [
  { key: 'cpi', label: 'CPI', unit: 'usd', direction: 'lower', availability: 'direct', source: 'bi_ads.ads_paid_acquisition_daily.cpi', description: '每个 Adjust 安装对应的广告消耗。' },
  { key: 'cpa', label: 'CPA', unit: 'usd', direction: 'lower', availability: 'pending', source: '待产品侧转化事件口径确认', description: '每个目标转化对应的广告消耗；当前 Doris 权限未提供目标转化指标。' },
  { key: 'd0_roas', label: 'D0 ROAS', unit: 'percent', direction: 'higher', availability: 'direct', source: 'bi_ads.ads_paid_acquisition_cohort_metric.d0_roas', description: '成熟 cohort 的首日广告支出回报。' },
  { key: 'ecpm', label: 'ECPM', unit: 'usd', direction: 'lower', availability: 'derived', source: 'bi_ads.ads_paid_acquisition_daily', formula: 'spend / impressions × 1000', description: '每千次广告展示对应的消耗。' },
  { key: 'retention_d1', label: '次留', unit: 'percent', direction: 'higher', availability: 'pending', source: '待产品后台次日留存数据集接入', description: '安装用户次日留存率。' },
  { key: 'ipu', label: 'IPU', unit: 'number', direction: 'higher', availability: 'pending', source: '待产品负责人确认业务定义与数据字段', description: '保留产品原始 IPU 口径，不在未确认前推导。' },
  { key: 'arpu', label: 'ARPU', unit: 'usd', direction: 'higher', availability: 'derived', source: 'bi_ads.ads_paid_acquisition_daily', formula: 'adjust_revenue / adjust_installs', description: '每个 Adjust 安装用户对应的收入。' },
];

@Injectable()
export class LocalDatabaseService implements OnModuleDestroy {
  private readonly database: DatabaseSync;

  constructor() {
    const databasePath: string = resolve(
      process.env.GROWTH_DATABASE_PATH || 'runtime/ai-growth.sqlite',
    );
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.initializeSchema();
    this.seedWingslite();
  }

  onModuleDestroy(): void {
    this.database.close();
  }

  listProducts(): GrowthProduct[] {
    const rows: Record<string, unknown>[] = this.database
      .prepare('SELECT payload FROM growth_product ORDER BY updated_at DESC')
      .all();
    return rows.map(
      (row: Record<string, unknown>): GrowthProduct =>
        this.normalizeProduct(this.parsePayload<GrowthProduct>(row.payload)),
    );
  }

  getProduct(id: string): GrowthProduct | undefined {
    const row: Record<string, unknown> | undefined = this.database
      .prepare('SELECT payload FROM growth_product WHERE id = ?')
      .get(id);
    return row
      ? this.normalizeProduct(this.parsePayload<GrowthProduct>(row.payload))
      : undefined;
  }

  saveProduct(product: GrowthProduct): void {
    const updatedAt: string = new Date().toISOString();
    this.database
      .prepare(
        `
        INSERT INTO growth_product (id, name, updated_at, payload)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          updated_at = excluded.updated_at,
          payload = excluded.payload
      `,
      )
      .run(product.id, product.name, updatedAt, JSON.stringify(product));
  }

  listDecisionRecords(limit = 200): DecisionRecord[] {
    const rows: Record<string, unknown>[] = this.database
      .prepare(
        `
        SELECT payload
        FROM growth_decision_record
        ORDER BY created_at DESC
        LIMIT ?
      `,
      )
      .all(limit);
    return rows.map(
      (row: Record<string, unknown>): DecisionRecord =>
        this.parsePayload<DecisionRecord>(row.payload),
    );
  }

  getDecisionRecord(id: string): DecisionRecord | undefined {
    const row: Record<string, unknown> | undefined = this.database
      .prepare('SELECT payload FROM growth_decision_record WHERE id = ?')
      .get(id);
    return row ? this.parsePayload<DecisionRecord>(row.payload) : undefined;
  }

  saveDecisionRecord(record: DecisionRecord): void {
    this.database
      .prepare(
        `
        INSERT INTO growth_decision_record (
          id, product_id, status, created_at, updated_at, payload
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          product_id = excluded.product_id,
          status = excluded.status,
          updated_at = excluded.updated_at,
          payload = excluded.payload
      `,
      )
      .run(
        record.id,
        record.productId,
        record.status,
        record.createdAt,
        new Date().toISOString(),
        JSON.stringify(record),
      );
  }

  appendActivity(input: DecisionActivityInput): void {
    const createdAt: string = new Date().toISOString();
    this.database
      .prepare(
        `
        INSERT INTO growth_decision_activity (
          id, case_id, action, actor, detail, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        randomUUID(),
        input.caseId,
        input.action,
        input.actor,
        input.detail,
        JSON.stringify(input.metadata),
        createdAt,
      );
  }

  listActivities(recordId: string, limit = 100): GrowthDecisionActivity[] {
    const rows: Record<string, unknown>[] = this.database
      .prepare(
        `SELECT id, case_id, action, actor, detail, metadata, created_at
         FROM growth_decision_activity
         WHERE case_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(recordId, limit);
    return rows.map((row) => ({
      id: String(row.id),
      recordId: String(row.case_id),
      action: String(row.action),
      actor: String(row.actor),
      detail: String(row.detail),
      metadata: this.parsePayload<Record<string, string>>(row.metadata),
      createdAt: String(row.created_at),
    }));
  }

  listFetchRuns(productId?: string, limit = 100): GrowthFetchRun[] {
    const rows: Record<string, unknown>[] = productId
      ? this.database
          .prepare('SELECT payload FROM growth_fetch_run WHERE product_id = ? ORDER BY started_at DESC LIMIT ?')
          .all(productId, limit)
      : this.database
          .prepare('SELECT payload FROM growth_fetch_run ORDER BY started_at DESC LIMIT ?')
          .all(limit);
    return rows.map((row) => this.parsePayload<GrowthFetchRun>(row.payload));
  }

  saveFetchRun(run: GrowthFetchRun): void {
    this.database
      .prepare(`
        INSERT INTO growth_fetch_run (id, product_id, status, started_at, payload)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          product_id = excluded.product_id,
          status = excluded.status,
          started_at = excluded.started_at,
          payload = excluded.payload
      `)
      .run(run.id, run.productId || null, run.status, run.startedAt, JSON.stringify(run));
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS growth_product (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS growth_decision_record (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES growth_product(id)
      );

      CREATE INDEX IF NOT EXISTS idx_growth_record_product
        ON growth_decision_record(product_id);
      CREATE INDEX IF NOT EXISTS idx_growth_record_status
        ON growth_decision_record(status);
      CREATE INDEX IF NOT EXISTS idx_growth_record_created
        ON growth_decision_record(created_at DESC);

      CREATE TABLE IF NOT EXISTS growth_decision_activity (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        detail TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_growth_activity_case
        ON growth_decision_activity(case_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS growth_fetch_run (
        id TEXT PRIMARY KEY,
        product_id TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES growth_product(id)
      );

      CREATE INDEX IF NOT EXISTS idx_growth_fetch_product
        ON growth_fetch_run(product_id, started_at DESC);
    `);
  }

  private seedWingslite(): void {
    if (this.getProduct(WINGSLITE_PRODUCT_ID)) return;

    const product: GrowthProduct = {
      id: WINGSLITE_PRODUCT_ID,
      name: 'Wingslite',
      status: 'active',
      targetMetric: 'd0_roas',
      channel: 'facebook',
      accountId:
        '2540310543056369,1488251649657730,1733669357668273,' +
        '912419838148429,4559331474385863,1633581281710424',
      accountIds: [
        '2540310543056369',
        '1488251649657730',
        '1733669357668273',
        '912419838148429',
        '4559331474385863',
        '1633581281710424',
      ],
      dataDelayMinutes: 60,
      skillVersion: 'wingslite-facebook-decision',
      dorisSource:
        'bi_ads.ads_paid_acquisition_daily + ' +
        'bi_ads.ads_paid_acquisition_cohort_metric',
      thresholds: {
        status: 'calibration_required',
        markets: 'IN,PK',
        cohortMaturityHours: 72,
        increaseEnabled: false,
        decreaseEnabled: false,
      },
      metrics: DEFAULT_GROWTH_METRICS,
    };
    this.saveProduct(product);
  }

  private parsePayload<T>(value: unknown): T {
    if (typeof value !== 'string') {
      throw new Error('本地数据库记录格式错误');
    }
    return JSON.parse(value) as T;
  }

  private normalizeProduct(product: GrowthProduct): GrowthProduct {
    const savedMetrics = new Map(
      (product.metrics || []).map((metric) => [metric.key, metric]),
    );
    return {
      ...product,
      metrics: DEFAULT_GROWTH_METRICS.map((definition) => {
        const saved = savedMetrics.get(definition.key);
        const legacyThreshold = saved?.anomalyThreshold;
        const lowerBound = saved?.lowerBound ??
          (saved?.direction === 'higher' ? legacyThreshold : undefined);
        const upperBound = saved?.upperBound ??
          (saved?.direction === 'lower' ? legacyThreshold : undefined);
        return {
          ...definition,
          standardValue: saved?.standardValue,
          lowerBound,
          upperBound,
          updatedAt: saved?.updatedAt,
          updatedBy: saved?.updatedBy,
        };
      }),
    };
  }
}

export { DEFAULT_GROWTH_METRICS };
export type { DecisionActivityInput, DecisionRecord };
