import axios from 'axios';

import type {
  GrowthDashboardResponse,
  GrowthDecisionCase,
  GrowthFetchHistoryResponse,
  GrowthFetchRun,
  GrowthJudgment,
  GrowthProduct,
  ReviewJudgmentRequest,
  UpdateDecisionRequest,
  UpdateMetricStandardsRequest,
  UpdateResultRequest,
} from '@shared/api.interface';

async function getDashboard(): Promise<GrowthDashboardResponse> {
  const response = await axios.get<GrowthDashboardResponse>(
    '/api/growth-decision/dashboard',
  );
  return response.data;
}

async function getFetchHistory(productId?: string): Promise<GrowthFetchHistoryResponse> {
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
  getDashboard,
  getFetchHistory,
  reviewJudgment,
  triggerFetch,
  updateDecision,
  updateMetricStandards,
  updateResult,
};
