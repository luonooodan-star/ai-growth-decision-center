export interface GrowthProduct {
  id: string;
  name: string;
  status: string;
  targetMetric: string;
  channel: string;
  accountId?: string;
  accountIds: string[];
  adAccounts?: GrowthAdAccount[];
  accountSyncAt?: string;
  dataDelayMinutes: number;
  skillVersion: string;
  dorisSource?: string;
  dorisAppId?: number;
  lastSyncAt?: string;
  thresholds: Record<string, number | string | boolean | null>;
  metrics: GrowthMetricDefinition[];
  latestMetricValues?: GrowthMetricValues;
  analysisMode?: GrowthAnalysisMode;
}

export type GrowthAnalysisMode = 'product_skill' | 'marvis_bridge';

export type GrowthAdAccountActivityStatus =
  | 'new'
  | 'active'
  | 'inactive'
  | 'unknown';

export interface GrowthAdAccount {
  id: string;
  activityStatus: GrowthAdAccountActivityStatus;
  firstSeenDate?: string;
  lastSeenDate?: string;
  spend30d: number;
  impressions30d: number;
  discoveredAt: string;
  updatedAt: string;
  source: 'doris_facebook_campaign_daily' | 'legacy_config';
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

export type GrowthDeliveryMetricKey =
  | 'spend'
  | 'impressions'
  | 'media_clicks'
  | 'media_installs'
  | 'adjust_installs'
  | 'adjust_revenue'
  | 'cpi'
  | 'ecpm'
  | 'ctr'
  | 'ipm'
  | 'roas'
  | 'd0_roas';

export type GrowthDeliveryMetricValues = Partial<
  Record<GrowthDeliveryMetricKey, number>
>;

export interface GrowthDiagnosticBreakdown {
  dimension:
    | 'country'
    | 'adset'
    | 'ad'
    | 'placement'
    | 'age'
    | 'gender'
    | 'audience';
  value: string;
  label?: string;
  metrics: GrowthDeliveryMetricValues;
}

export interface GrowthDiagnosticContext {
  dataDate: string;
  comparisonDays: number;
  current: GrowthDeliveryMetricValues;
  previousAverage: GrowthDeliveryMetricValues;
  changesPct: GrowthDeliveryMetricValues;
  breakdowns: GrowthDiagnosticBreakdown[];
  availableFields: string[];
  missingFields: string[];
  availableDimensions: string[];
  missingDimensions: string[];
}

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
  historyDays?: 7 | 14 | 30;
}

export interface GrowthDataSnapshot {
  id: string;
  productId: string;
  productName: string;
  dataDate: string;
  metrics: GrowthDeliveryMetricValues;
  campaignCount: number;
  adsetCount: number;
  sourceRows: number;
  fetchedAt: string;
}

export interface GrowthDataHistoryResponse {
  items: GrowthDataSnapshot[];
}

export interface ResetGrowthHistoryRequest {
  confirmation: 'RESET_HISTORY';
}

export interface GrowthHistoryResetResult {
  resetAt: string;
  deleted: {
    fetchRuns: number;
    snapshots: number;
    decisionRecords: number;
    activities: number;
    mavisJobs: number;
    monitoringSnapshots: number;
  };
  preserved: {
    products: number;
    metricStandards: number;
  };
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
  adAccountId?: string;
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
  diagnosticContext?: GrowthDiagnosticContext;
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
  isFocused?: boolean;
  focusedAt?: string;
  focusedBy?: string;
  experimentStartedAt?: string;
  experimentExpiresAt?: string;
  normalSince?: string;
  recoveryReadyAt?: string;
  latestObservedValue?: number;
  completedAt?: string;
  observationEndedAt?: string;
  hideAfterAt?: string;
  supersededByCaseId?: string;
  deletedAt?: string;
  deletedBy?: string;
  deletionReason?: string;
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
  adAccountId?: string;
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
  diagnosticContext?: GrowthDiagnosticContext;
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
  skillCandidateDeletedAt?: string;
  skillCandidateDeletedBy?: string;
  skillCandidateDeletionReason?: string;
  reviewReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  isFocused?: boolean;
  focusedAt?: string;
  focusedBy?: string;
  observationStartedAt?: string;
  observationNormalSince?: string;
  observationRecoveryReadyAt?: string;
  observationResolvedAt?: string;
  latestObservedValue?: number;
  deletedAt?: string;
  deletedBy?: string;
  deletionReason?: string;
  createdAt: string;
}

export type GrowthMonitoringSubjectType =
  | 'judgment_observation'
  | 'experiment';

export interface GrowthMonitoringSnapshot {
  id: string;
  recordId: string;
  productId: string;
  subjectType: GrowthMonitoringSubjectType;
  observedAt: string;
  dataDate: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  metrics: GrowthDeliveryMetricValues;
  previousMetrics: GrowthDeliveryMetricValues;
  changesPct: GrowthDeliveryMetricValues;
  isWithinNormalRange: boolean;
  isBaseline?: boolean;
  source: string;
}

export interface GrowthMonitoringHistoryResponse {
  items: GrowthMonitoringSnapshot[];
}

export type GrowthAiJudgment = 'confirmed' | 'uncertain' | 'rejected';

export interface GrowthAiAnalysis {
  provider: 'codex' | 'mavis' | 'product_skill';
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
  recommendedActions?: GrowthActionProposal[];
  adFindings?: GrowthAdFinding[];
  fallbackReason?: string;
  generatedAt: string;
}

export interface GrowthAdFinding {
  adId: string;
  adName?: string;
  severity: 'medium' | 'high' | 'critical';
  issue: string;
  evidence: string[];
  suggestedAction: string;
}

export interface GrowthActionProposal {
  actionType:
    | 'increase_budget'
    | 'decrease_budget'
    | 'hold_budget'
    | 'exclude_target'
    | 'rotate_creative'
    | 'create_experiment'
    | 'observe'
    | 'investigate_data';
  targetLevel: 'product' | 'campaign' | 'adset' | 'ad' | 'creative';
  targetId: string;
  targetName?: string;
  changePct?: number;
  rationale: string;
  steps: string[];
  guardrails: string[];
  rollbackCondition: string;
  observationHours: number;
}

export interface GrowthAiProviderStatus {
  provider: 'codex';
  model: string;
  configured: boolean;
  runtimeMode: 'external_worker' | 'skill_simulation';
  mcpConfigured: boolean;
  queuedJobs: number;
  runningJobs: number;
  fallbackProvider: 'product_skill';
  fallbackAvailable: true;
  selectedMode: GrowthAnalysisMode;
}

export interface UpdateGrowthAnalysisModeRequest {
  mode: GrowthAnalysisMode;
}

export interface GrowthBatchAnalysisResponse {
  mode: GrowthAnalysisMode;
  analyzedCount: number;
  job?: GrowthMavisJob;
  message: string;
}

export interface AnalyzeJudgmentRequest {
  mode?: 'default' | 'external_only';
}

export type GrowthMavisJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface GrowthMavisJob {
  id: string;
  judgmentId: string;
  productId: string;
  productName: string;
  judgmentIds?: string[];
  jobType: 'anomaly_assessment' | 'batch_anomaly_assessment';
  trigger: 'automatic' | 'manual';
  status: GrowthMavisJobStatus;
  workerId?: string;
  skillVersion: string;
  attempt: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
}

export interface GrowthMavisJobListResponse {
  items: GrowthMavisJob[];
}

export interface ClaimGrowthMavisJobRequest {
  workerId: string;
}

export interface GrowthMavisJobContext {
  job: GrowthMavisJob;
  product: GrowthProduct;
  judgment: GrowthJudgment;
  judgments: GrowthJudgment[];
  metricStandards: GrowthMetricDefinition[];
  outputContract: {
    judgment: GrowthAiJudgment[];
    confidenceRange: [number, number];
    observationHoursRange: [number, number];
    requiredAnalysis: string[];
    supportedActionTypes: GrowthActionProposal['actionType'][];
  };
}

export interface CompleteGrowthMavisBatchJobRequest {
  workerId: string;
  model: string;
  analyses: Array<{
    judgmentId: string;
    analysis: CompleteGrowthMavisJobRequest['analysis'];
  }>;
}

export interface CompleteGrowthMavisJobRequest {
  workerId: string;
  model: string;
  analysis: Omit<
    GrowthAiAnalysis,
    'provider' | 'model' | 'generatedAt' | 'fallbackReason'
  >;
}

export interface FailGrowthMavisJobRequest {
  workerId: string;
  error: string;
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

export interface UpdateRecordFocusRequest {
  focused: boolean;
}

export interface DeleteGrowthRecordRequest {
  confirmation: 'DELETE_RECORD';
  reason: string;
}

export interface DeleteSkillRuleCandidateRequest {
  confirmation: 'DELETE_SKILL_CANDIDATE';
  reason: string;
}

export interface GrowthDeletionResult {
  id: string;
  deletedAt: string;
  archived: true;
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
  adAccountId?: string;
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
  diagnosticContext?: GrowthDiagnosticContext;
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
  adAccountId?: string;
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
  diagnosticContext?: GrowthDiagnosticContext;
  spend?: number;
  evidence: string;
  rootCause: string;
  confidence: number;
  preliminaryJudgment: string;
  skillRuleCandidate?: string;
}

export interface ReviewJudgmentRequest {
  action: 'confirmed' | 'deferred' | 'rejected' | 'observing' | 'resolved';
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
