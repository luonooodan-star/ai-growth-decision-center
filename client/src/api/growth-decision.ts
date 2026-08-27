import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

import type {
  GrowthDashboardResponse,
  GrowthDecisionCase,
  UpdateDecisionRequest,
  UpdateResultRequest,
} from '@shared/api.interface';

async function getDashboard(): Promise<GrowthDashboardResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/growth-decision/dashboard',
      method: 'GET',
    });
    return response.data as GrowthDashboardResponse;
  } catch (error: unknown) {
    logger.error('加载增长决策工作台失败', error);
    throw error;
  }
}

async function updateDecision(
  id: string,
  request: UpdateDecisionRequest,
): Promise<GrowthDecisionCase> {
  try {
    const response = await axiosForBackend({
      url: `/api/growth-decision/cases/${id}/decision`,
      method: 'PATCH',
      data: request,
    });
    return response.data as GrowthDecisionCase;
  } catch (error: unknown) {
    logger.error('更新建议决策失败', error);
    throw error;
  }
}

async function updateResult(
  id: string,
  request: UpdateResultRequest,
): Promise<GrowthDecisionCase> {
  try {
    const response = await axiosForBackend({
      url: `/api/growth-decision/cases/${id}/result`,
      method: 'PATCH',
      data: request,
    });
    return response.data as GrowthDecisionCase;
  } catch (error: unknown) {
    logger.error('记录实验结果失败', error);
    throw error;
  }
}

export { getDashboard, updateDecision, updateResult };
