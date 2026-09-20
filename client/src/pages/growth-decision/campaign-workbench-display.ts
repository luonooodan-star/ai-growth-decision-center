import type {
  CampaignDecisionCard,
  CampaignVerdict,
} from '@shared/api.interface';
export type WorkbenchFilter =
  | CampaignVerdict
  | 'today'
  | 'actionable'
  | 'urgent'
  | 'all'
  | 'inactive'
  | 'repair'
  | 'archive'
  | 'due'
  | 'pending';
export const WORK_QUEUES = {
  urgent: '优先处理',
  opportunity: '加量机会',
  due: '到期复查',
  pending: '待执行',
  observation: '观察中',
  normal: '正常投放',
  repair: '数据待修复',
  inactive: '无新增投放',
  archive: '历史归档',
};
export function inWorkbench(
  card: CampaignDecisionCard,
  filter: WorkbenchFilter,
): boolean {
  const q = card.workQueue;
  if (filter === 'all') return q !== 'archive';
  if (filter === 'today' || filter === 'actionable')
    return q
      ? ['urgent', 'opportunity', 'due', 'pending'].includes(q)
      : !card.noRecentDelivery && card.verdict !== 'normal';
  if (
    ['urgent', 'due', 'pending', 'repair', 'archive', 'inactive'].includes(
      filter,
    )
  )
    return q === filter;
  return (
    !['repair', 'inactive', 'archive'].includes(q || '') &&
    card.verdict === filter
  );
}
