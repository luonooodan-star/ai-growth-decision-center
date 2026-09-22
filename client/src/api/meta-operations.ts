import axios from 'axios';
import type {
  MetaOperationOverview,
  MetaAdEntity,
  WeeklySkillReportSummary,
} from '@shared/api.interface';
const root = '/api/growth-decision/meta-operations';
export const getWeeklyReviews = async (): Promise<WeeklySkillReportSummary[]> =>
  (await axios.get(`${root}/weekly`)).data;
export const generateWeeklyReviews = async (): Promise<
  WeeklySkillReportSummary[]
> => (await axios.post(`${root}/weekly`)).data;
export const retryWeeklyReview = async (id: string) =>
  (await axios.post(`${root}/weekly/${encodeURIComponent(id)}/retry`)).data;
export const reviewWeeklyCandidate = async (
  id: string,
  index: number,
  decision: 'approved' | 'rejected',
) =>
  (
    await axios.post(`${root}/weekly/${encodeURIComponent(id)}/review`, {
      index,
      decision,
    })
  ).data;
export const saveOperationReason = async (id: string, reason: string) =>
  (await axios.post(`${root}/${encodeURIComponent(id)}/reason`, { reason }))
    .data;

export async function getMetaOperations(
  page = 1,
  category = 'all',
  productId?: string,
): Promise<MetaOperationOverview> {
  return (
    await axios.get<MetaOperationOverview>(
      '/api/growth-decision/meta-operations',
      { params: { page, category, productId } },
    )
  ).data;
}
export async function getOperationTimeline(
  id: string,
): Promise<import('@shared/meta-operations').OperationTimeline> {
  return (await axios.get(`${root}/${encodeURIComponent(id)}/timeline`)).data;
}
export async function getMetaEntities(): Promise<MetaAdEntity[]> {
  return (
    await axios.get<MetaAdEntity[]>(
      '/api/growth-decision/meta-operations/entities',
    )
  ).data;
}
