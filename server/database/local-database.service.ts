import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  CampaignDailySnapshot,
  GrowthDecisionCase,
  GrowthDecisionActivity,
  GrowthDataSnapshot,
  GrowthFetchRun,
  GrowthFetchCheckpoint,
  GrowthHistoryResetResult,
  GrowthJudgment,
  GrowthMavisJob,
  GrowthMetricDefinition,
  GrowthMonitoringSnapshot,
  GrowthProduct,
  MetaOperation,
  MetaAdEntity,
  OperationDecisionEvidence,
  WeeklySkillReport,
  SavedCampaignRecommendation,
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
  {
    key: 'cpi',
    label: 'CPI',
    unit: 'usd',
    direction: 'lower',
    availability: 'direct',
    source: 'bi_ads.ads_paid_acquisition_daily.cpi',
    description: '每个 Adjust 安装对应的广告消耗。',
  },
  {
    key: 'cpa',
    label: 'CPA',
    unit: 'usd',
    direction: 'lower',
    availability: 'pending',
    source: '待产品侧转化事件口径确认',
    description:
      '每个目标转化对应的广告消耗；当前 Doris 权限未提供目标转化指标。',
  },
  {
    key: 'd0_roas',
    label: 'D0 ROAS',
    unit: 'percent',
    direction: 'higher',
    availability: 'direct',
    source: 'bi_ads.ads_paid_acquisition_cohort_metric.d0_roas',
    description: '成熟 cohort 的首日广告支出回报。',
  },
  {
    key: 'ecpm',
    label: 'ECPM',
    unit: 'usd',
    direction: 'lower',
    availability: 'derived',
    source: 'bi_ads.ads_paid_acquisition_daily',
    formula: 'spend / impressions × 1000',
    description: '每千次广告展示对应的消耗。',
  },
  {
    key: 'retention_d1',
    label: '次留',
    unit: 'percent',
    direction: 'higher',
    availability: 'pending',
    source: '待产品后台次日留存数据集接入',
    description: '安装用户次日留存率。',
  },
  {
    key: 'ipu',
    label: 'IPU',
    unit: 'number',
    direction: 'higher',
    availability: 'pending',
    source: '待产品负责人确认业务定义与数据字段',
    description: '保留产品原始 IPU 口径，不在未确认前推导。',
  },
  {
    key: 'arpu',
    label: 'ARPU',
    unit: 'usd',
    direction: 'higher',
    availability: 'derived',
    source: 'bi_ads.ads_paid_acquisition_daily',
    formula: 'adjust_revenue / adjust_installs',
    description: '每个 Adjust 安装用户对应的收入。',
  },
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

  saveMetaOperation(item: MetaOperation): boolean {
    const result = this.database
      .prepare(
        'INSERT OR IGNORE INTO growth_meta_operation (id, occurred_at, payload) VALUES (?, ?, ?)',
      )
      .run(item.id, item.occurredAt, JSON.stringify(item));
    return result.changes === 1;
  }

  listMetaOperations(): MetaOperation[] {
    return this.database
      .prepare(
        'SELECT payload FROM growth_meta_operation ORDER BY occurred_at DESC, id',
      )
      .all()
      .map((row) => this.parsePayload<MetaOperation>(row.payload));
  }

  saveMetaEntity(item: MetaAdEntity): void {
    const row = this.database.prepare('SELECT payload FROM growth_meta_entity WHERE account_id = ? AND id = ?')
      .get(item.accountId, item.id);
    const previous = row ? this.parsePayload<MetaAdEntity>(row.payload) : undefined;
    if (previous && Date.parse(previous.fetchedAt) > Date.parse(item.fetchedAt)) return;
    // A partial attributes response must not erase fields fetched in a previous batch.
    const merged = { ...previous, ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) } as MetaAdEntity;
    if (item.conversionEventStatus === 'not_configured') delete merged.conversionEvent;
    this.database
      .prepare(
        `INSERT INTO growth_meta_entity (account_id, id, fetched_at, payload) VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload
      WHERE excluded.fetched_at >= growth_meta_entity.fetched_at`,
      )
      .run(item.accountId, item.id, item.fetchedAt, JSON.stringify(merged));
  }

  listMetaEntities(): MetaAdEntity[] {
    return this.database
      .prepare('SELECT payload FROM growth_meta_entity')
      .all()
      .map((row) => this.parsePayload<MetaAdEntity>(row.payload));
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

  getOperationEvidence(id: string): OperationDecisionEvidence | undefined {
    const row = this.database
      .prepare('SELECT payload FROM growth_operation_evidence WHERE id = ?')
      .get(id);
    return row
      ? this.parsePayload<OperationDecisionEvidence>(row.payload)
      : undefined;
  }
  saveCampaignRecommendation(item: SavedCampaignRecommendation): void {
    this.database
      .prepare(
        'INSERT OR IGNORE INTO growth_campaign_recommendation (id, payload) VALUES (?, ?)',
      )
      .run(item.id, JSON.stringify(item));
  }
  listCampaignRecommendations(): SavedCampaignRecommendation[] {
    return this.database
      .prepare('SELECT payload FROM growth_campaign_recommendation')
      .all()
      .map((r) => this.parsePayload<SavedCampaignRecommendation>(r.payload));
  }
  saveOperationEvidence(item: OperationDecisionEvidence): void {
    this.database
      .prepare(
        'INSERT INTO growth_operation_evidence (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(item.operationId, JSON.stringify(item));
  }
  listSkillReports(): WeeklySkillReport[] {
    return this.database
      .prepare('SELECT payload FROM growth_skill_report ORDER BY id DESC')
      .all()
      .map((r) => this.parsePayload<WeeklySkillReport>(r.payload));
  }
  saveSkillReport(report: WeeklySkillReport): void {
    this.database
      .prepare(
        'INSERT INTO growth_skill_report (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(report.id, JSON.stringify(report));
  }

  getBiCache(key: string): string | undefined {
    const row = this.database
      .prepare('SELECT payload FROM growth_bi_cache WHERE cache_key = ?')
      .get(key);
    return row ? String(row.payload) : undefined;
  }

  saveBiCache(key: string, payload: string): void {
    this.database
      .prepare(
        'INSERT INTO growth_bi_cache (cache_key, payload) VALUES (?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload',
      )
      .run(key, payload);
    // Only disposable BI cache is bounded; decision snapshots and history are untouched.
    this.database
      .prepare(
        `DELETE FROM growth_bi_cache WHERE cache_key IN (
      SELECT cache_key FROM (
        SELECT cache_key,
          SUM(length(CAST(payload AS BLOB))) OVER (
            ORDER BY json_extract(payload, '$.updatedAt') DESC, cache_key
          ) AS bytes,
          ROW_NUMBER() OVER (ORDER BY json_extract(payload, '$.updatedAt') DESC, cache_key) AS position
        FROM growth_bi_cache
      ) WHERE bytes > 134217728 OR position > 1500
    )`,
      )
      .run();
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

  listDecisionRecords(limit = 200, includeDeleted = false): DecisionRecord[] {
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
    const records: DecisionRecord[] = rows.map(
      (row: Record<string, unknown>): DecisionRecord =>
        this.parsePayload<DecisionRecord>(row.payload),
    );
    return includeDeleted
      ? records
      : records.filter((record: DecisionRecord): boolean => !record.deletedAt);
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
          .prepare(
            'SELECT payload FROM growth_fetch_run WHERE product_id = ? ORDER BY started_at DESC LIMIT ?',
          )
          .all(productId, limit)
      : this.database
          .prepare(
            'SELECT payload FROM growth_fetch_run ORDER BY started_at DESC LIMIT ?',
          )
          .all(limit);
    return rows.map((row) => this.parsePayload<GrowthFetchRun>(row.payload));
  }

  saveFetchRun(run: GrowthFetchRun): void {
    this.database
      .prepare(
        `
        INSERT INTO growth_fetch_run (id, product_id, status, started_at, payload)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          product_id = excluded.product_id,
          status = excluded.status,
          started_at = excluded.started_at,
          payload = excluded.payload
      `,
      )
      .run(
        run.id,
        run.productId || null,
        run.status,
        run.startedAt,
        JSON.stringify(run),
      );
  }

  listDataSnapshots(productId: string, limit = 90): GrowthDataSnapshot[] {
    const rows: Record<string, unknown>[] = this.database
      .prepare(
        `SELECT payload FROM growth_metric_snapshot
         WHERE product_id = ? ORDER BY data_date DESC LIMIT ?`,
      )
      .all(productId, limit);
    return rows.map(
      (row: Record<string, unknown>): GrowthDataSnapshot =>
        this.parsePayload<GrowthDataSnapshot>(row.payload),
    );
  }

  listCampaignSnapshots(productId: string): CampaignDailySnapshot[] {
    return this.database
      .prepare(
        'SELECT payload FROM growth_campaign_snapshot WHERE product_id = ? ORDER BY data_date DESC',
      )
      .all(productId)
      .map(
        (row: Record<string, unknown>): CampaignDailySnapshot =>
          this.parsePayload<CampaignDailySnapshot>(row.payload),
      );
  }

  saveCampaignSnapshot(snapshot: CampaignDailySnapshot): void {
    this.database
      .prepare(
        `INSERT INTO growth_campaign_snapshot (campaign_key, product_id, data_date, payload)
      VALUES (?, ?, ?, ?) ON CONFLICT(campaign_key, data_date) DO UPDATE SET payload = excluded.payload`,
      )
      .run(
        snapshot.key,
        snapshot.productId,
        snapshot.dataDate,
        JSON.stringify(snapshot),
      );
  }

  getFetchCheckpoint(key: string): GrowthFetchCheckpoint | undefined {
    const row = this.database
      .prepare(
        'SELECT payload FROM growth_fetch_checkpoint WHERE checkpoint_key = ?',
      )
      .get(key);
    return row
      ? this.parsePayload<GrowthFetchCheckpoint>(row.payload)
      : undefined;
  }

  saveFetchCheckpoint(value: GrowthFetchCheckpoint): void {
    this.database
      .prepare(
        'INSERT INTO growth_fetch_checkpoint (checkpoint_key, updated_at, payload) VALUES (?, ?, ?) ON CONFLICT(checkpoint_key) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload',
      )
      .run(value.key, value.updatedAt, JSON.stringify(value));
  }

  pruneFetchCheckpoints(): void {
    this.database
      .prepare('DELETE FROM growth_fetch_checkpoint WHERE updated_at < ?')
      .run(new Date(Date.now() - 48 * 3600_000).toISOString());
  }

  saveDataSnapshot(snapshot: GrowthDataSnapshot): void {
    this.database
      .prepare(
        `INSERT INTO growth_metric_snapshot (
           id, product_id, data_date, updated_at, payload
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(product_id, data_date) DO UPDATE SET
           id = excluded.id,
           updated_at = excluded.updated_at,
           payload = excluded.payload`,
      )
      .run(
        snapshot.id,
        snapshot.productId,
        snapshot.dataDate,
        snapshot.fetchedAt,
        JSON.stringify(snapshot),
      );
  }

  listMonitoringSnapshots(
    recordId: string,
    limit = 240,
  ): GrowthMonitoringSnapshot[] {
    const rows: Record<string, unknown>[] = this.database
      .prepare(
        `SELECT payload FROM growth_monitoring_snapshot
         WHERE record_id = ? ORDER BY observed_at DESC LIMIT ?`,
      )
      .all(recordId, limit);
    return rows.map(
      (row: Record<string, unknown>): GrowthMonitoringSnapshot =>
        this.parsePayload<GrowthMonitoringSnapshot>(row.payload),
    );
  }

  saveMonitoringSnapshot(snapshot: GrowthMonitoringSnapshot): void {
    this.database
      .prepare(
        `INSERT INTO growth_monitoring_snapshot (
           id, record_id, product_id, subject_type, observed_at, payload
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.id,
        snapshot.recordId,
        snapshot.productId,
        snapshot.subjectType,
        snapshot.observedAt,
        JSON.stringify(snapshot),
      );
  }

  resetGrowthHistory(): GrowthHistoryResetResult {
    const countRows = (tableName: string): number => {
      const row: Record<string, unknown> = this.database
        .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
        .get() || { count: 0 };
      return Number(row.count || 0);
    };
    const deleted: GrowthHistoryResetResult['deleted'] = {
      fetchRuns: countRows('growth_fetch_run'),
      snapshots:
        countRows('growth_metric_snapshot') +
        countRows('growth_campaign_snapshot'),
      decisionRecords: countRows('growth_decision_record'),
      activities: countRows('growth_decision_activity'),
      mavisJobs: countRows('growth_mavis_job'),
      monitoringSnapshots: countRows('growth_monitoring_snapshot'),
    };
    const products: GrowthProduct[] = this.listProducts();
    const resetAt: string = new Date().toISOString();

    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.exec(`
        DELETE FROM growth_decision_activity;
        DELETE FROM growth_mavis_job;
        DELETE FROM growth_decision_record;
        DELETE FROM growth_fetch_run;
        DELETE FROM growth_fetch_checkpoint;
        DELETE FROM growth_metric_snapshot;
        DELETE FROM growth_campaign_snapshot;
        DELETE FROM growth_monitoring_snapshot;
      `);
      const updateProduct = this.database.prepare(
        'UPDATE growth_product SET payload = ?, updated_at = ? WHERE id = ?',
      );
      for (const product of products) {
        const resetProduct: GrowthProduct = { ...product };
        delete resetProduct.lastSyncAt;
        delete resetProduct.latestMetricValues;
        updateProduct.run(JSON.stringify(resetProduct), resetAt, product.id);
      }
      this.database
        .prepare(
          `INSERT INTO growth_history_reset_audit
           (id, reset_at, deleted_counts) VALUES (?, ?, ?)`,
        )
        .run(randomUUID(), resetAt, JSON.stringify(deleted));
      this.database.exec('COMMIT;');
    } catch (error: unknown) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    return {
      resetAt,
      deleted,
      preserved: {
        products: products.length,
        metricStandards: products.reduce(
          (total: number, product: GrowthProduct): number =>
            total + product.metrics.length,
          0,
        ),
      },
    };
  }

  listMavisJobs(judgmentId?: string, limit = 100): GrowthMavisJob[] {
    const rows: Record<string, unknown>[] = judgmentId
      ? this.database
          .prepare(
            `SELECT payload FROM growth_mavis_job
             WHERE judgment_id = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(judgmentId, limit)
      : this.database
          .prepare(
            'SELECT payload FROM growth_mavis_job ORDER BY created_at DESC LIMIT ?',
          )
          .all(limit);
    return rows.map(
      (row: Record<string, unknown>): GrowthMavisJob =>
        this.parsePayload<GrowthMavisJob>(row.payload),
    );
  }

  getMavisJob(id: string): GrowthMavisJob | undefined {
    const row: Record<string, unknown> | undefined = this.database
      .prepare('SELECT payload FROM growth_mavis_job WHERE id = ?')
      .get(id);
    return row ? this.parsePayload<GrowthMavisJob>(row.payload) : undefined;
  }

  saveMavisJob(job: GrowthMavisJob): void {
    this.database
      .prepare(
        `INSERT INTO growth_mavis_job (
           id, judgment_id, product_id, status, created_at, payload
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           judgment_id = excluded.judgment_id,
           product_id = excluded.product_id,
           status = excluded.status,
           payload = excluded.payload`,
      )
      .run(
        job.id,
        job.judgmentId,
        job.productId,
        job.status,
        job.createdAt,
        JSON.stringify(job),
      );
  }

  claimNextMavisJob(workerId: string): GrowthMavisJob | undefined {
    const now: Date = new Date();
    const runningRows: Record<string, unknown>[] = this.database
      .prepare(
        `SELECT payload FROM growth_mavis_job
         WHERE status = 'running' ORDER BY created_at ASC`,
      )
      .all();
    for (const runningRow of runningRows) {
      const running: GrowthMavisJob = this.parsePayload<GrowthMavisJob>(
        runningRow.payload,
      );
      const leaseExpiresAt: number = running.leaseExpiresAt
        ? new Date(running.leaseExpiresAt).getTime()
        : new Date(running.startedAt || running.createdAt).getTime() +
          25 * 60 * 1000;
      if (leaseExpiresAt > now.getTime()) continue;
      const recovered: GrowthMavisJob = {
        ...running,
        status: 'queued',
        workerId: undefined,
        startedAt: undefined,
        leaseExpiresAt: undefined,
        error: '上一次 Codex 执行超时，已自动重新排队',
      };
      this.saveMavisJob(recovered);
    }
    const row: Record<string, unknown> | undefined = this.database
      .prepare(
        `SELECT payload FROM growth_mavis_job
         WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
      )
      .get();
    if (!row) return undefined;
    const queued: GrowthMavisJob = this.parsePayload<GrowthMavisJob>(
      row.payload,
    );
    const claimed: GrowthMavisJob = {
      ...queued,
      status: 'running',
      workerId,
      attempt: queued.attempt + 1,
      startedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(now.getTime() + 25 * 60 * 1000).toISOString(),
    };
    const result = this.database
      .prepare(
        `UPDATE growth_mavis_job SET status = ?, payload = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(claimed.status, JSON.stringify(claimed), claimed.id);
    return result.changes === 1 ? claimed : undefined;
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS growth_operation_evidence (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS growth_campaign_recommendation (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS growth_skill_report (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS growth_meta_operation (
        id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS growth_meta_entity (
        account_id TEXT NOT NULL, id TEXT NOT NULL, fetched_at TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      );
      CREATE TABLE IF NOT EXISTS growth_bi_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS growth_fetch_checkpoint (
        checkpoint_key TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS growth_campaign_snapshot (
        campaign_key TEXT NOT NULL, product_id TEXT NOT NULL, data_date TEXT NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY (campaign_key, data_date)
      );
      CREATE INDEX IF NOT EXISTS growth_campaign_product_date ON growth_campaign_snapshot(product_id, data_date);
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

      CREATE TABLE IF NOT EXISTS growth_metric_snapshot (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        data_date TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(product_id, data_date),
        FOREIGN KEY (product_id) REFERENCES growth_product(id)
      );

      CREATE INDEX IF NOT EXISTS idx_growth_snapshot_product_date
        ON growth_metric_snapshot(product_id, data_date DESC);

      CREATE TABLE IF NOT EXISTS growth_monitoring_snapshot (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES growth_product(id)
      );

      CREATE INDEX IF NOT EXISTS idx_growth_monitoring_record_time
        ON growth_monitoring_snapshot(record_id, observed_at DESC);

      CREATE TABLE IF NOT EXISTS growth_mavis_job (
        id TEXT PRIMARY KEY,
        judgment_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES growth_product(id)
      );

      CREATE INDEX IF NOT EXISTS idx_growth_mavis_job_status
        ON growth_mavis_job(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_growth_mavis_job_judgment
        ON growth_mavis_job(judgment_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS growth_history_reset_audit (
        id TEXT PRIMARY KEY,
        reset_at TEXT NOT NULL,
        deleted_counts TEXT NOT NULL
      );
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
      analysisMode: 'product_skill',
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
      analysisMode: product.analysisMode || 'product_skill',
      accountIds: product.accountIds || [],
      adAccounts:
        product.adAccounts ||
        (product.accountIds || []).map((accountId: string) => ({
          id: accountId,
          activityStatus: 'unknown',
          spend30d: 0,
          impressions30d: 0,
          discoveredAt: product.lastSyncAt || '1970-01-01T00:00:00.000Z',
          updatedAt: product.lastSyncAt || '1970-01-01T00:00:00.000Z',
          source: 'legacy_config',
        })),
      metrics: DEFAULT_GROWTH_METRICS.map((definition) => {
        const saved = savedMetrics.get(definition.key);
        const legacyThreshold = saved?.anomalyThreshold;
        const lowerBound =
          saved?.lowerBound ??
          (saved?.direction === 'higher' ? legacyThreshold : undefined);
        const upperBound =
          saved?.upperBound ??
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
