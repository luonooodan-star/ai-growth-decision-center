export interface MetaAdjustmentTarget {
  id: string;
  accountId: string;
  campaignId: string;
  adsetId?: string;
  level: 'campaign' | 'adset' | 'ad';
}
export async function resolveCampaignAccounts(
  ids: string[],
  graph: MetaGraphCall,
) {
  if (
    !Array.isArray(ids) ||
    ids.length > 10 ||
    ids.some((id) => typeof id !== 'string' || !/^\d{1,40}$/.test(id))
  )
    throw new Error('广告系列 ID 无效');
  const campaigns: Array<{ campaignId: string; accountId: string }> = [];
  const unavailable: string[] = [];
  const queue = [...new Set(ids)];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (queue.length) {
        const id = queue.shift()!;
        try {
          const entity = await graph(id, { fields: 'id,account_id,objective' });
          if (
            String(entity.id) !== id ||
            !/^\d{1,40}$/.test(String(entity.account_id || '')) ||
            typeof entity.objective !== 'string'
          )
            throw new Error('无法确认系列归属');
          campaigns.push({
            campaignId: id,
            accountId: String(entity.account_id),
          });
        } catch {
          unavailable.push(id);
        }
      }
    }),
  );
  return { campaigns, unavailable };
}
export interface MetaAdjustmentSnapshot extends MetaAdjustmentTarget {
  name: string;
  status: string;
  effectiveStatus: string;
  currency: string;
  dailyBudget: string | null;
  budgetEditable: boolean;
  budgetReason: string;
}
export interface MetaAdjustmentChange {
  before: MetaAdjustmentSnapshot;
  status?: 'ACTIVE' | 'PAUSED';
  dailyBudget?: string;
}
export interface MetaAdjustmentItem extends MetaAdjustmentChange {
  /** Frozen server-side immediately before apply; never reconstructed from later data. */
  evidence?: {
    capturedAt: string;
    productId?: string;
    baseline?: import('./api.interface').CampaignDailySnapshot;
    recommendation?: import('./skill-review').SavedCampaignRecommendation;
    note: string;
    skillVersion?: string;
    strategies?: import('./api.interface').GrowthProduct['knowledge'];
  };
  startedAt?: string;
  completedAt?: string;
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'uncertain';
  error?: string;
  after?: MetaAdjustmentSnapshot;
}
export interface MetaAdjustmentJob {
  id: string;
  ownerId: string;
  centerUsername?: string;
  createdAt: string;
  submittedAt?: string;
  completedAt?: string;
  state: 'preview' | 'running' | 'completed' | 'interrupted';
  items: MetaAdjustmentItem[];
}
export function validateAdjustmentTarget(value: MetaAdjustmentTarget): void {
  if (
    !value ||
    !['campaign', 'adset', 'ad'].includes(value.level) ||
    ![value.id, value.accountId, value.campaignId].every(
      (v) => typeof v === 'string' && /^\d+$/.test(v),
    ) ||
    (value.level === 'ad' && !/^\d+$/.test(value.adsetId || ''))
  )
    throw new Error('对象 ID、账户或层级无效');
}
export function adjustmentBudgetUnits(value: string): string {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error('预算必须为正数，最多两位小数');
  const [whole, fraction = ''] = value.split('.');
  const units = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(units) || units <= 0)
    throw new Error('预算超出范围');
  return String(units);
}
export function validateAdjustmentChange(change: MetaAdjustmentChange): void {
  validateAdjustmentTarget(change.before);
  if (
    change.status !== undefined &&
    !['ACTIVE', 'PAUSED'].includes(change.status)
  )
    throw new Error('只允许开启或暂停');
  if (change.dailyBudget !== undefined) {
    if (
      !change.before.budgetEditable ||
      change.before.currency !== 'USD' ||
      change.before.level === 'ad'
    )
      throw new Error('该对象不支持修改日预算');
    adjustmentBudgetUnits(change.dailyBudget);
  }
  if (change.status === undefined && change.dailyBudget === undefined)
    throw new Error('没有待提交的修改');
}
export const adjustmentSnapshotMatches = (
  a: MetaAdjustmentSnapshot,
  b: MetaAdjustmentSnapshot,
) =>
  a.id === b.id &&
  a.accountId === b.accountId &&
  a.level === b.level &&
  a.campaignId === b.campaignId &&
  a.adsetId === b.adsetId &&
  a.status === b.status &&
  a.currency === b.currency &&
  a.dailyBudget === b.dailyBudget &&
  a.budgetEditable === b.budgetEditable;

export type MetaGraphCall = (
  path: string,
  params: Record<string, string>,
  post?: boolean,
) => Promise<Record<string, unknown>>;

/** Runs in the original uploader process, using its existing session and Graph client. */
export async function readAdjustmentSnapshot(
  target: MetaAdjustmentTarget,
  graph: MetaGraphCall,
): Promise<MetaAdjustmentSnapshot> {
  validateAdjustmentTarget(target);
  const fields =
    'id,name,account_id,status,effective_status' +
    (target.level === 'campaign'
      ? ',objective,daily_budget,lifetime_budget'
      : target.level === 'adset'
        ? ',campaign_id,optimization_goal,daily_budget,lifetime_budget'
        : ',campaign_id,adset_id,creative{id}');
  const entity = await graph(target.id, { fields });
  if (
    String(entity.id) !== target.id ||
    String(entity.account_id) !== target.accountId ||
    (target.level !== 'campaign' &&
      String(entity.campaign_id) !== target.campaignId) ||
    (target.level === 'campaign' && target.id !== target.campaignId) ||
    (target.level === 'ad' && String(entity.adset_id) !== target.adsetId)
  )
    throw new Error('Meta 对象归属不匹配，已阻止操作');
  const account = await graph(`act_${target.accountId}`, {
    fields: 'currency',
  });
  const currency = String(account.currency || '');
  const daily = Number(entity.daily_budget || 0);
  let budgetReason =
    target.level === 'ad'
      ? '广告无独立预算，请调整所属预算层级'
      : Number(entity.lifetime_budget || 0) > 0
        ? '总预算模式，不能切换为日预算'
        : !Number.isSafeInteger(daily) || daily <= 0
          ? '非日预算持有层级'
          : currency !== 'USD'
            ? '当前只开放 USD 日预算，其他币种暂不修改'
            : '';
  if (target.level === 'adset') {
    const parent = await graph(target.campaignId, {
      fields: 'daily_budget,lifetime_budget',
    });
    if (
      Number(parent.daily_budget || 0) > 0 ||
      Number(parent.lifetime_budget || 0) > 0
    )
      budgetReason = '系列统一预算，请在广告系列调整';
  }
  return {
    ...target,
    name: String(entity.name || target.id),
    status: String(entity.status || ''),
    effectiveStatus: String(entity.effective_status || ''),
    currency,
    dailyBudget: daily > 0 ? String(entity.daily_budget) : null,
    budgetEditable:
      !budgetReason && ['ACTIVE', 'PAUSED'].includes(String(entity.status)),
    budgetReason,
  };
}
