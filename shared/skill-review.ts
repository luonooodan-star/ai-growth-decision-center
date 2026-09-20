import type {
  CampaignDecisionCard,
  CampaignDecisionRule,
  GrowthDecisionCase,
  GrowthProduct,
  MetaOperationReview,
} from './api.interface';
export interface SavedCampaignRecommendation {
  id: string;
  productId: string;
  createdAt: string;
  skillVersion: string;
  card: CampaignDecisionCard;
  rules?: CampaignDecisionRule[];
}
export interface OperationDecisionEvidence {
  operationId: string;
  capturedAt: string;
  state: 'conflict' | 'aligned' | 'unknown';
  explanation: string;
  recommendation?: {
    sourceId: string;
    recordedAt: string;
    verdict: string;
    rule?: CampaignDecisionCard['matchedRule'];
    action: string;
    skillVersion?: string;
    ruleDefinition?: CampaignDecisionRule;
    dataDate?: string;
    metrics?: CampaignDecisionCard['snapshot']['metrics'];
  };
  humanReason?: string;
  reasonUpdatedAt?: string;
}
export interface WeeklySkillCandidate {
  title: string;
  conclusion: string;
  caution: string;
  evidenceIds: string[];
  suggestedRule?: CampaignDecisionRule;
  decision?: 'approved' | 'rejected';
  reviewedAt?: string;
}
export interface WeeklySkillReport {
  id: string;
  productId: string;
  weekStart: string;
  weekEnd: string;
  createdAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  leaseToken?: string;
  leaseUntil?: string;
  attempt: number;
  error?: string;
  completedAt?: string;
  evidence: {
    product: GrowthProduct;
    operations: Array<
      MetaOperationReview & { decision: OperationDecisionEvidence }
    >;
    manualRecords: GrowthDecisionCase[];
    coverage: {
      totalOperations: number;
      returnedOperations: number;
      truncated: boolean;
    };
  };
  summary?: string;
  candidates?: WeeklySkillCandidate[];
}
export type WeeklySkillReportSummary = Omit<
  WeeklySkillReport,
  'evidence' | 'leaseToken'
> & {
  evidence: {
    product: Pick<GrowthProduct, 'id' | 'name'>;
    coverage: WeeklySkillReport['evidence']['coverage'];
  };
};
