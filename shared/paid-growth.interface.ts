export const BI_LEVELS = {
  overall: '产品 / 渠道',
  campaigns: '广告系列',
  adgroups: '广告组',
  creatives: '素材',
  countries: '国家',
  designers: '设计师',
  optimizers: '优化师',
} as const;
export type BiLevel = keyof typeof BI_LEVELS;
export type BiRawRow = Record<string, unknown>;
export interface BiPart {
  accountNextOffset?: number;
  accountOwnerId?: string;
  rows: BiRawRow[];
  state: 'fresh' | 'cached' | 'stale' | 'missing' | 'unsupported';
  updatedAt?: string;
  message?: string;
}
export interface BiDay {
  date: string;
  level: BiLevel;
  daily: BiPart;
  revenue: BiPart;
  events: BiPart;
}
export interface BiProduct {
  appId: number;
  name: string;
  channel: string;
  spend: number;
  productId?: string;
}
export interface BiQuery {
  date: string;
  level: BiLevel;
  appId?: string;
  media?: string;
  refresh?: string;
}
export interface BiRow {
  key: string;
  appId: number;
  appName: string;
  media: string;
  label: string;
  campaignId?: string;
  campaignName?: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  installs: number | null;
  mediaInstalls: number | null;
  revenue: number | null;
  events: number | null;
  cpi: number | null;
  mediaCpi: number | null;
  cpm: number | null;
  ctr: number | null;
  d0Roas: number | null;
  missingDays: number;
}
