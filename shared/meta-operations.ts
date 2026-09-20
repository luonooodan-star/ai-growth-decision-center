import type { CampaignDailySnapshot } from './api.interface';

export type MetaOperationCategory =
  | 'increase'
  | 'decrease'
  | 'pause'
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
  id: string;
  importedAt: string;
  category: MetaOperationCategory;
  changePct?: number;
  productId?: string;
  linked: boolean;
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
  objective?: string;
  optimizationGoal?: string;
  conversionEvent?: string;
  fetchedAt: string;
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
