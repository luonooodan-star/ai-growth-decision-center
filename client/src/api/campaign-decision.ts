import axios from 'axios';
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
} from '@shared/api.interface';

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
): Promise<GrowthJudgment> {
  return (
    await axios.post<GrowthJudgment>(
      `/api/growth-decision/products/${productId}/campaign-analysis`,
      { key, revision },
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
