/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, numeric, pgTable, text, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const decisionActivity = pgTable("decision_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  actor: varchar("actor", { length: 120 }),
  detail: text("detail").notNull(),
  /**
   * @type { previousStatus?: string; nextStatus?: string; source?: string; requestId?: string }
   */
  metadata: jsonb("metadata").notNull().default('{}'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_decision_activity_case").on(table.caseId, table.createdAt),
]);

export const decisionCase = pgTable("decision_case", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull(),
  anomalyType: varchar("anomaly_type", { length: 64 }).notNull(),
  severity: varchar("severity", { length: 24 }).notNull().default('medium'),
  status: varchar("status", { length: 32 }).notNull().default('pending'),
  channel: varchar("channel", { length: 32 }).notNull().default('facebook'),
  campaignId: varchar("campaign_id", { length: 120 }),
  campaignName: varchar("campaign_name", { length: 255 }),
  adsetId: varchar("adset_id", { length: 120 }),
  adsetName: varchar("adset_name", { length: 255 }),
  audienceId: varchar("audience_id", { length: 120 }),
  audienceName: varchar("audience_name", { length: 255 }),
  adId: varchar("ad_id", { length: 120 }),
  adName: varchar("ad_name", { length: 255 }),
  creativeId: varchar("creative_id", { length: 120 }),
  creativeName: varchar("creative_name", { length: 255 }),
  targetMetric: varchar("target_metric", { length: 64 }).notNull(),
  currentValue: numeric("current_value"),
  baselineValue: numeric("baseline_value"),
  deviationPct: numeric("deviation_pct"),
  evidence: text("evidence").notNull(),
  rootCause: text("root_cause").notNull(),
  confidence: numeric("confidence").notNull().default('0'),
  recommendation: text("recommendation").notNull(),
  /**
   * @type { actionType?: string; targetLevel?: string; targetId?: string; changePct?: number; parameters?: Record<string, string | number | boolean> }
   */
  recommendedAction: jsonb("recommended_action").notNull().default('{}'),
  expectedImpact: text("expected_impact").notNull(),
  riskNote: text("risk_note"),
  decisionReason: text("decision_reason"),
  decidedBy: varchar("decided_by", { length: 120 }),
  decidedAt: customTimestamptz("decided_at", { precision: 3 }),
  executedAt: customTimestamptz("executed_at", { precision: 3 }),
  observationEndsAt: customTimestamptz("observation_ends_at", { precision: 3 }),
  resultClassification: varchar("result_classification", { length: 32 }),
  actualChangePct: numeric("actual_change_pct"),
  actualResult: text("actual_result"),
  /**
   * @type { dataUpdatedAt?: string; spend?: number; conversions?: number; attributionWindow?: string; dimensions?: Record<string, string> }
   */
  sourceSnapshot: jsonb("source_snapshot").notNull().default('{}'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_decision_case_product").on(table.productId),
  index("idx_decision_case_status").on(table.status),
  index("idx_decision_case_created").on(table.createdAt),
]);

export const productProfile = pgTable("product_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default('active'),
  targetMetric: varchar("target_metric", { length: 64 }).notNull().default('cpa'),
  channel: varchar("channel", { length: 32 }).notNull().default('facebook'),
  accountId: varchar("account_id", { length: 120 }),
  dataDelayMinutes: integer("data_delay_minutes").notNull().default(60),
  skillVersion: varchar("skill_version", { length: 32 }).notNull().default('v0.1.0'),
  dorisSource: varchar("doris_source", { length: 255 }),
  /**
   * @type { minSpend?: number; minConversions?: number; cpaDeviationPct?: number; roasDeviationPct?: number }
   */
  thresholds: jsonb("thresholds").notNull().default('{}'),
  lastSyncAt: customTimestamptz("last_sync_at", { precision: 3 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_product_profile_status").on(table.status),
]);

// table aliases
export const decisionActivityTable = decisionActivity;
export const decisionCaseTable = decisionCase;
export const productProfileTable = productProfile;
