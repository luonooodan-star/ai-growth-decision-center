export type FunnelPlatform = 'android' | 'ios';
export interface CreativeAnalysisQuery {
  start: string;
  end: string;
  platform: FunnelPlatform | 'all';
  refresh?: boolean;
}
export interface CreativeTagParse {
  version: 'v2' | 'unknown';
  codes: string[];
  unknown: string[];
  warnings: string[];
}
export const FUNNEL_METRICS = [
  'chat',
  'chat5',
  'chat20',
  'payShow',
  'payClick',
  'paySuccess',
  'successAny',
  'orders',
] as const;
export type FunnelMetric = (typeof FUNNEL_METRICS)[number];
export type FunnelCounts = { users: number } & Record<
  FunnelMetric,
  number | null
>;
export interface CreativeFunnelRow extends FunnelCounts {
  key: string;
  date: string;
  platform: FunnelPlatform;
  country: string;
  channel: string;
  attribution: 'matched' | 'unattributed' | 'ambiguous' | 'unavailable';
  creativeName: string;
  creativeId: string;
  campaignName: string;
  tags: CreativeTagParse;
}
export interface CreativeAnalysisReport {
  schemaVersion: 2;
  scope: CreativeAnalysisQuery;
  generatedAt: string;
  cache: boolean;
  rows: CreativeFunnelRow[];
  issues: string[];
  excludedFirstOpenEvents: number;
  duplicateFirstOpenUsers: number;
}
export interface CreativeAnalysisJob {
  id: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: string;
  report?: CreativeAnalysisReport;
  error?: string;
}
