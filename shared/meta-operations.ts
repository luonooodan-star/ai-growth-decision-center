import type { CampaignDailySnapshot } from './api.interface';

export type MetaOperationCategory =
  | 'increase'
  | 'decrease'
  | 'pause'
  | 'resume'
  | 'adjust'
  | 'other';
export interface MetaOperationInput {
  accountId: string;
  campaignId?: string;
  campaignName?: string;
  objectId: string;
  objectName: string;
  objectLevel: 'campaign' | 'adset' | 'ad' | 'account';
  actorId: string;
  actorName: string;
  systemActor: boolean;
  /** ISO timestamp with explicit UTC offset, verified from account timezone. */
  occurredAt: string;
  accountTimezone: string;
  eventType: string;
  field:
    | 'budget'
    | 'status'
    | 'targeting'
    | 'bid'
    | 'creative'
    | 'optimization'
    | 'created'
    | 'other';
  before?: string | number;
  after?: string | number;
  objective?: string;
  optimizationGoal?: string;
  conversionEvent?: string;
  /** Raw Meta log, retained for auditing. No credentials. */
  raw: string;
}
export interface MetaOperation extends MetaOperationInput {
  adsetId?: string;
  deliveryStatus?: string;
  source?: 'adjustment_page' | 'meta_import';
  adjustmentJobId?: string;
  capturedEvidence?: import('./meta-adjustment').MetaAdjustmentItem['evidence'];
  /** Current entity settings; never interpreted as settings at occurredAt. */
  currentTargets?: MetaTargetSummary;
  id: string;
  importedAt: string;
  category: MetaOperationCategory;
  changePct?: number;
  productId?: string;
  linked: boolean;
}
export interface OperationObservation {
  id: string;
  operationId: string;
  productId?: string;
  accountId: string;
  campaignId: string;
  objectId: string;
  observedAt: string;
  kind: 'adjustment' | 'periodic';
  snapshot?: CampaignDailySnapshot;
  note: string;
}
export interface OperationTimeline {
  operations: MetaOperation[];
  observations: OperationObservation[];
  truncated: boolean;
}
export interface MetaOperationImport {
  operations: MetaOperationInput[];
  entities?: MetaAdEntity[];
}
export interface MetaAdEntity {
  accountId: string;
  id: string;
  campaignId: string;
  level: 'campaign' | 'adset' | 'ad';
  name: string;
  adsetId?: string;
  objective?: string;
  optimizationGoal?: string;
  conversionEvent?: string;
  conversionEventStatus?: 'returned' | 'not_configured' | 'unsupported';
  fetchedAt: string;
}
export interface MetaTargetSummary {
  objectives: string[];
  optimizationGoals: string[];
  conversionEvents: string[];
  fetchedAt?: string;
  eventStatus: 'returned' | 'not_configured' | 'unsupported' | 'pending';
}
export interface MetaSyncPlan {
  generatedAt: string;
  total: number;
  offset: number;
  nextOffset: number | null;
  targets: Array<{
    productId: string;
    accountId: string;
    campaignId: string;
    adsetIds: string[];
    adIds: string[];
    lastFetchedAt?: string;
    missingFields: string[];
  }>;
  unresolvedCampaigns: number;
}
export interface MetaOperationReview {
  decision?: import('./skill-review').OperationDecisionEvidence;
  operation: MetaOperation;
  before: CampaignDailySnapshot[];
  after: CampaignDailySnapshot[];
  intervening: string[];
  summary: string;
  dataTimezone: 'Asia/Shanghai';
  comparisonScope: 'campaign';
}
export interface MetaOperationOverview {
  items: MetaOperationReview[];
  total: number;
  lastImportAt?: string;
  page: number;
}
