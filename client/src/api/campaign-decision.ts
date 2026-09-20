import axios from 'axios';

export async function recordCampaignView(
  productId: string,
  key: string,
  revision: string,
) {
  return (
    await axios.post(
      `/api/growth-decision/products/${productId}/campaign-viewed`,
      { key, revision },
    )
  ).data;
}
import type {
  CampaignDecisionBoard,
  CampaignDecisionPolicy,
  CampaignRulesConfig,
  CampaignRulesSaveResult,
  CampaignBatchAnalysisRequest,
  CampaignBatchAnalysisResult,
  DecideCampaignRequest,
  GrowthDecisionCase,
  GrowthJudgment,
  CampaignRulesPreview,
  CampaignRuleVersion,
  OptimizerReview,
  OptimizerWeeklyState,
} from '@shared/api.interface';

export async function weeklyReview(
  productId: string,
  action: 'read' | 'generate' | 'configure',
  enabled?: boolean,
): Promise<OptimizerWeeklyState> {
  const url = `/api/growth-decision/products/${productId}/weekly-review`;
  return (
    action === 'read'
      ? await axios.get<OptimizerWeeklyState>(url)
      : action === 'generate'
        ? await axios.post<OptimizerWeeklyState>(url)
        : await axios.put<OptimizerWeeklyState>(url, { enabled })
  ).data;
}

export async function getOptimizerReview(
  productId: string,
): Promise<OptimizerReview> {
  return (
    await axios.get<OptimizerReview>(
      `/api/growth-decision/products/${productId}/optimizer-review`,
    )
  ).data;
}
export async function reviewObservation(
  id: string,
  action: 'finish' | 'extend',
  reason: string,
) {
  return (
    await axios.post(
      `/api/growth-decision/campaign-orders/${id}/observation-review`,
      { action, reason, confirmation: 'REVIEW_OBSERVATION' },
    )
  ).data;
}
export async function approveKnowledge(id: string, conclusion: string) {
  return (
    await axios.post(`/api/growth-decision/campaign-orders/${id}/knowledge`, {
      conclusion,
      confirmation: 'APPROVE_KNOWLEDGE',
    })
  ).data;
}

export async function previewCampaignRules(
  productId: string,
  rules: CampaignRulesConfig,
): Promise<CampaignRulesPreview> {
  return (
    await axios.post<CampaignRulesPreview>(
      `/api/growth-decision/products/${productId}/campaign-rules/preview`,
      rules,
    )
  ).data;
}
export async function getCampaignRuleVersions(
  productId: string,
): Promise<CampaignRuleVersion[]> {
  return (
    await axios.get<CampaignRuleVersion[]>(
      `/api/growth-decision/products/${productId}/campaign-rules/versions`,
    )
  ).data;
}

export async function getCampaignRules(
  productId: string,
): Promise<CampaignRulesConfig> {
  return (
    await axios.get<CampaignRulesConfig>(
      `/api/growth-decision/products/${productId}/campaign-rules`,
    )
  ).data;
}
export async function saveCampaignRules(
  productId: string,
  rules: CampaignRulesConfig,
): Promise<CampaignRulesSaveResult> {
  return (
    await axios.put<CampaignRulesSaveResult>(
      `/api/growth-decision/products/${productId}/campaign-rules`,
      rules,
    )
  ).data;
}
export async function analyzeCampaignBatch(
  productId: string,
  request: CampaignBatchAnalysisRequest,
): Promise<CampaignBatchAnalysisResult> {
  return (
    await axios.post<CampaignBatchAnalysisResult>(
      `/api/growth-decision/products/${productId}/campaign-analysis-batch`,
      request,
    )
  ).data;
}

export async function getCampaignBoard(
  productId: string,
): Promise<CampaignDecisionBoard> {
  return (
    await axios.get<CampaignDecisionBoard>(
      `/api/growth-decision/products/${productId}/campaign-board`,
    )
  ).data;
}
export async function saveCampaignPolicy(
  productId: string,
  policy: CampaignDecisionPolicy,
): Promise<CampaignDecisionPolicy> {
  return (
    await axios.patch<CampaignDecisionPolicy>(
      `/api/growth-decision/products/${productId}/campaign-policy`,
      policy,
    )
  ).data;
}
export async function analyzeCampaign(
  productId: string,
  key: string,
  revision: string,
  force = false,
): Promise<GrowthJudgment> {
  return (
    await axios.post<GrowthJudgment>(
      `/api/growth-decision/products/${productId}/campaign-analysis`,
      { key, revision, force },
    )
  ).data;
}

export async function observeCampaignBatch(
  productId: string,
  campaigns: CampaignBatchAnalysisRequest['campaigns'],
  reason: string,
): Promise<CampaignBatchAnalysisResult> {
  return (
    await axios.post<CampaignBatchAnalysisResult>(
      `/api/growth-decision/products/${productId}/campaign-observations-batch`,
      { campaigns, reason, confirmation: 'OBSERVE_BATCH' },
    )
  ).data;
}
export async function decideCampaign(
  productId: string,
  request: DecideCampaignRequest,
): Promise<GrowthDecisionCase> {
  return (
    await axios.post<GrowthDecisionCase>(
      `/api/growth-decision/products/${productId}/campaign-decisions`,
      request,
    )
  ).data;
}
export async function executeCampaign(
  id: string,
  note: string,
): Promise<GrowthDecisionCase> {
  return (
    await axios.post<GrowthDecisionCase>(
      `/api/growth-decision/campaign-orders/${id}/executed`,
      { confirmation: 'EXECUTED', note },
    )
  ).data;
}
