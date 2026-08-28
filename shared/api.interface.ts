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
