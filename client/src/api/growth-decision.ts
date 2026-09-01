import axios from 'axios';

import type {
  GrowthAiProviderStatus,
  GrowthAnalysisMode,
  GrowthBatchAnalysisResponse,
  GrowthDashboardResponse,
  GrowthDataHistoryResponse,
  GrowthDecisionCase,
  GrowthDecisionHistoryResponse,
  GrowthFetchHistoryResponse,
  GrowthFetchRun,
  GrowthJudgment,
  GrowthHistoryResetResult,
  GrowthMavisJobListResponse,
  GrowthProduct,
  ReviewJudgmentRequest,
  UpdateDecisionRequest,
  UpdateMetricStandardsRequest,
  UpdateResultRequest,
} from '@shared/api.interface';

async function getAiStatus(
  productId?: string,
): Promise<GrowthAiProviderStatus> {
  const response = await axios.get<GrowthAiProviderStatus>(
    '/api/growth-decision/mavis/status',
    { params: productId ? { productId } : undefined },
  );
  return response.data;
}

async function updateAnalysisMode(
  productId: string,
  mode: GrowthAnalysisMode,
): Promise<GrowthProduct> {
  const response = await axios.patch<GrowthProduct>(
    `/api/growth-decision/products/${productId}/analysis-mode`,
    { mode },
  );
  return response.data;
}

async function analyzeProductBatch(
  productId: string,
): Promise<GrowthBatchAnalysisResponse> {
  const response = await axios.post<GrowthBatchAnalysisResponse>(
    `/api/growth-decision/products/${productId}/analyze-batch`,
  );
  return response.data;
}

async function getDashboard(): Promise<GrowthDashboardResponse> {
  const response = await axios.get<GrowthDashboardResponse>(
    '/api/growth-decision/dashboard',
  );
  return response.data;
}

async function getFetchHistory(
  productId?: string,
): Promise<GrowthFetchHistoryResponse> {
  const path = productId
    ? `/api/growth-decision/products/${productId}/fetch-history`
    : '/api/growth-decision/fetch-history';
  const response = await axios.get<GrowthFetchHistoryResponse>(path);
  return response.data;
}

async function triggerFetch(productId?: string): Promise<GrowthFetchRun[]> {
  const response = await axios.post<GrowthFetchRun[]>(
    '/api/growth-decision/fetches/trigger',
    { productId },
  );
  return response.data;
}

async function backfillHistory(
  productId: string,
  historyDays: 7 | 14 | 30,
): Promise<GrowthFetchRun[]> {
  const response = await axios.post<GrowthFetchRun[]>(
    '/api/growth-decision/fetches/trigger',
    { productId, historyDays },
  );
  return response.data;
}

async function getDataHistory(
  productId: string,
): Promise<GrowthDataHistoryResponse> {
  const response = await axios.get<GrowthDataHistoryResponse>(
    `/api/growth-decision/products/${productId}/data-history`,
  );
  return response.data;
}

async function resetHistory(): Promise<GrowthHistoryResetResult> {
  const response = await axios.post<GrowthHistoryResetResult>(
    '/api/growth-decision/history/reset',
    { confirmation: 'RESET_HISTORY' },
  );
  return response.data;
}

async function updateMetricStandards(
  productId: string,
  request: UpdateMetricStandardsRequest,
): Promise<GrowthProduct> {
  const response = await axios.patch<GrowthProduct>(
    `/api/growth-decision/products/${productId}/metric-standards`,
    request,
  );
  return response.data;
}

async function reviewJudgment(
  id: string,
  request: ReviewJudgmentRequest,
): Promise<GrowthJudgment> {
  const response = await axios.patch<GrowthJudgment>(
    `/api/growth-decision/judgments/${id}/review`,
    request,
  );
  return response.data;
}

async function analyzeJudgment(id: string): Promise<GrowthJudgment> {
  const response = await axios.post<GrowthJudgment>(
    `/api/growth-decision/judgments/${id}/mavis-analysis`,
    { mode: 'default' },
  );
  return response.data;
}

async function getMavisJobs(id: string): Promise<GrowthMavisJobListResponse> {
  const response = await axios.get<GrowthMavisJobListResponse>(
    `/api/growth-decision/judgments/${id}/mavis-jobs`,
  );
  return response.data;
}

async function generateRecommendation(id: string): Promise<GrowthDecisionCase> {
  const response = await axios.post<GrowthDecisionCase>(
    `/api/growth-decision/judgments/${id}/generate-recommendation`,
  );
  return response.data;
}

async function getDecisionHistory(
  id: string,
): Promise<GrowthDecisionHistoryResponse> {
  const response = await axios.get<GrowthDecisionHistoryResponse>(
    `/api/growth-decision/records/${id}/history`,
  );
  return response.data;
}

async function updateDecision(
  id: string,
  request: UpdateDecisionRequest,
): Promise<GrowthDecisionCase> {
  const response = await axios.patch<GrowthDecisionCase>(
    `/api/growth-decision/cases/${id}/decision`,
    request,
  );
  return response.data;
}

async function updateResult(
  id: string,
  request: UpdateResultRequest,
): Promise<GrowthDecisionCase> {
  const response = await axios.patch<GrowthDecisionCase>(
    `/api/growth-decision/cases/${id}/result`,
    request,
  );
  return response.data;
}

export {
  analyzeProductBatch,
  analyzeJudgment,
  backfillHistory,
  getAiStatus,
  getDashboard,
  getDataHistory,
  generateRecommendation,
  getDecisionHistory,
  getFetchHistory,
  getMavisJobs,
  reviewJudgment,
  resetHistory,
  triggerFetch,
  updateAnalysisMode,
  updateDecision,
  updateMetricStandards,
  updateResult,
};
