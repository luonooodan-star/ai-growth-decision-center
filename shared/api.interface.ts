export interface GrowthProduct {
  id: string;
  name: string;
  status: string;
  targetMetric: string;
  channel: string;
  accountId?: string;
  accountIds: string[];
  dataDelayMinutes: number;
  skillVersion: string;
  dorisSource?: string;
  lastSyncAt?: string;
  thresholds: Record<string, number | string | boolean | null>;
  metrics: GrowthMetricDefinition[];
  latestMetricValues?: GrowthMetricValues;
}

export type GrowthMetricKey =
  | 'cpi'
  | 'cpa'
  | 'd0_roas'
  | 'ecpm'
  | 'retention_d1'
  | 'ipu'
  | 'arpu';

export type GrowthMetricAvailability = 'direct' | 'derived' | 'pending';

export interface GrowthMetricDefinition {
  key: GrowthMetricKey;
  label: string;
  unit: 'usd' | 'percent' | 'number';
  direction: 'higher' | 'lower';
  availability: GrowthMetricAvailability;
  source: string;
  formula?: string;
  description: string;
  standardValue?: number;
  lowerBound?: number;
  upperBound?: number;
  /** @deprecated 仅用于兼容旧数据，读取时会迁移为上下界。 */
  anomalyThreshold?: number;
  updatedAt?: string;
  updatedBy?: string;
}

export type GrowthMetricValues = Partial<Record<GrowthMetricKey, number>>;

export interface GrowthFetchRun {
  id: string;
  productId?: string;
  productName?: string;
  trigger: 'scheduled' | 'manual';
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  finishedAt?: string;
  rowsFetched: number;
  anomalyCount: number;
  source: string;
  message: string;
}

export interface GrowthFetchHistoryResponse {
  items: GrowthFetchRun[];
  scheduleMinutes: number;
  nextScheduledAt: string;
}

export interface TriggerGrowthFetchRequest {
  productId?: string;
}

export interface UpdateMetricStandardItem {
  key: GrowthMetricKey;
  standardValue?: number;
  lowerBound?: number;
  upperBound?: number;
}

export interface UpdateMetricStandardsRequest {
  metrics: UpdateMetricStandardItem[];
}

export interface RecommendedAction {
  actionType?: string;
  targetLevel?: string;
  targetId?: string;
  changePct?: number;
  parameters?: Record<string, string | number | boolean>;
}

export interface GrowthDecisionCase {
  id: string;
  productId: string;
  productName: string;
  anomalyType: string;
  severity: string;
  status: string;
  channel: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  audienceId?: string;
  audienceName?: string;
  adId?: string;
  adName?: string;
  creativeId?: string;
  creativeName?: string;
  targetMetric: string;
  currentValue?: number;
  baselineValue?: number;
  deviationPct?: number;
  metricValues?: GrowthMetricValues;
  spend?: number;
  sourceJudgmentId?: string;
  evidence: string;
  rootCause: string;
  confidence: number;
  recommendation: string;
  recommendedAction: RecommendedAction;
  expectedImpact: string;
  riskNote?: string;
  decisionReason?: string;
  decidedBy?: string;
  decidedAt?: string;
  executedAt?: string;
  observationEndsAt?: string;
  resultClassification?: string;
  actualChangePct?: number;
  actualResult?: string;
  createdAt: string;
}

export interface GrowthDashboardSummary {
  openAnomalies: number;
  pendingJudgments: number;
  confirmedJudgments: number;
  pendingDecisions: number;
  acceptedRecommendations: number;
  completedExperiments: number;
  expectedImprovementRate: number;
  medianDecisionMinutes: number;
  lastDataSyncAt?: string;
}

export interface GrowthDashboardResponse {
  summary: GrowthDashboardSummary;
  products: GrowthProduct[];
  judgments: GrowthJudgment[];
  cases: GrowthDecisionCase[];
}

export interface GrowthJudgment {
  id: string;
  productId: string;
  productName: string;
  anomalyType: string;
  severity: string;
  status: string;
  channel: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  audienceId?: string;
  audienceName?: string;
  adId?: string;
  adName?: string;
  creativeId?: string;
  creativeName?: string;
  targetMetric: string;
  currentValue?: number;
  baselineValue?: number;
  deviationPct?: number;
  metricValues?: GrowthMetricValues;
  spend?: number;
  recommendationCaseId?: string;
  recommendationCreatedAt?: string;
  aiAnalysisStatus?: 'running' | 'completed' | 'fallback' | 'failed';
  aiAnalysis?: GrowthAiAnalysis;
  evidence: string;
  rootCause: string;
  confidence: number;
  preliminaryJudgment: string;
  skillRuleCandidate?: string;
  reviewReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export type GrowthAiJudgment = 'confirmed' | 'uncertain' | 'rejected';

export interface GrowthAiAnalysis {
  provider: 'glm' | 'product_skill';
  model: string;
  judgment: GrowthAiJudgment;
  summary: string;
  primaryCause: string;
  evidence: string[];
  alternativeCauses: string[];
  recommendedNextStep: string;
  risk: string;
  confidence: number;
  observationHours: number;
  fallbackReason?: string;
  generatedAt: string;
}

export interface GrowthAiProviderStatus {
  provider: 'glm';
  model: string;
  configured: boolean;
  fallbackProvider: 'product_skill';
  fallbackAvailable: true;
}

export interface UpdateDecisionRequest {
  action: 'accepted' | 'rejected' | 'observing';
  reason: string;
}

export interface UpdateResultRequest {
  classification: 'expected' | 'partial' | 'neutral' | 'negative';
  actualChangePct: number;
  actualResult: string;
}

export interface CreateProductRequest {
  name: string;
  targetMetric: string;
  channel: string;
  accountId?: string;
  accountIds?: string[];
  dorisSource?: string;
  dataDelayMinutes?: number;
}

export interface IngestDecisionCaseRequest {
  productId: string;
  anomalyType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  channel: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  audienceId?: string;
  audienceName?: string;
  adId?: string;
  adName?: string;
  creativeId?: string;
  creativeName?: string;
  targetMetric: string;
  currentValue?: number;
  baselineValue?: number;
  deviationPct?: number;
  metricValues?: GrowthMetricValues;
  spend?: number;
  evidence: string;
  rootCause: string;
  confidence: number;
  recommendation: string;
  recommendedAction: RecommendedAction;
  expectedImpact: string;
  riskNote?: string;
}

export interface IngestJudgmentRequest {
  productId: string;
  anomalyType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  channel: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  audienceId?: string;
  audienceName?: string;
  adId?: string;
  adName?: string;
  creativeId?: string;
  creativeName?: string;
  targetMetric: string;
  currentValue?: number;
  baselineValue?: number;
  deviationPct?: number;
  metricValues?: GrowthMetricValues;
  spend?: number;
  evidence: string;
  rootCause: string;
  confidence: number;
  preliminaryJudgment: string;
  skillRuleCandidate?: string;
}

export interface ReviewJudgmentRequest {
  action: 'confirmed' | 'deferred' | 'rejected';
  reason: string;
  skillRuleCandidate?: string;
}

export interface CreateRecommendationFromJudgmentRequest {
  recommendation: string;
  recommendedAction: RecommendedAction;
  expectedImpact: string;
  riskNote?: string;
}

export interface GrowthDecisionActivity {
  id: string;
  recordId: string;
  action: string;
  actor: string;
  detail: string;
  metadata: Record<string, string>;
  createdAt: string;
}

export interface GrowthDecisionHistoryResponse {
  items: GrowthDecisionActivity[];
}
