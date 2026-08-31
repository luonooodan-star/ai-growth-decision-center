import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  GrowthDecisionCase,
  GrowthJudgment,
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
        this.parsePayload<GrowthProduct>(row.payload),
    );
  }

  getProduct(id: string): GrowthProduct | undefined {
    const row: Record<string, unknown> | undefined = this.database
      .prepare('SELECT payload FROM growth_product WHERE id = ?')
      .get(id);
    return row ? this.parsePayload<GrowthProduct>(row.payload) : undefined;
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
    };
    this.saveProduct(product);
  }

  private parsePayload<T>(value: unknown): T {
    if (typeof value !== 'string') {
      throw new Error('本地数据库记录格式错误');
    }
    return JSON.parse(value) as T;
  }
}

export type { DecisionActivityInput, DecisionRecord };
