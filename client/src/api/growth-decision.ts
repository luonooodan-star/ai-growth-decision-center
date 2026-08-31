import axios from 'axios';

import type {
  GrowthDashboardResponse,
  GrowthDecisionCase,
  GrowthJudgment,
  ReviewJudgmentRequest,
  UpdateDecisionRequest,
  UpdateResultRequest,
} from '@shared/api.interface';

async function getDashboard(): Promise<GrowthDashboardResponse> {
  const response = await axios.get<GrowthDashboardResponse>(
    '/api/growth-decision/dashboard',
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

export { getDashboard, reviewJudgment, updateDecision, updateResult };
