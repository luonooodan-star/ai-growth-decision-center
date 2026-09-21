import type { BiPart } from './paid-growth.interface';

export const ADJUSTMENT_REFRESH_MS = 4 * 60 * 60 * 1000;
export interface AdjustmentQuery {
  date: string;
  appId?: string;
  media?: string;
  refresh?: string;
}
export interface AdjustmentDay {
  date: string;
  daily: BiPart;
  revenue: BiPart;
  accounts: BiPart;
}
export interface AdjustmentFilters {
  search: string;
  account: string;
  optimizer: string;
  country: string;
}
export interface AdjustmentMetrics {
  stale?: boolean;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  installs: number | null;
  revenue: number | null;
  cpm: number | null;
  cpi: number | null;
  ctr: number | null;
  cvr: number | null;
  roas: number | null;
}
export interface AdjustmentNode {
  key: string;
  id: string;
  name: string;
  appId: number;
  appName: string;
  media: string;
  campaignId: string;
  account: string;
  level: 'campaign' | 'adgroup' | 'creative';
  days: Record<string, AdjustmentMetrics>;
  children: AdjustmentNode[];
}
