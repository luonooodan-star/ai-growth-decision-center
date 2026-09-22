export interface MetaAdjustmentTarget {
  id: string;
  accountId: string;
  campaignId: string;
  adsetId?: string;
  level: 'campaign' | 'adset' | 'ad';
}

export const META_FAILURE_MESSAGES = {
  authentication:
    'Meta 登录凭据无效或已过期，请在原工具确认个人登录后重新授权。',
  permission: '当前 Meta 身份缺少所需权限，请检查应用权限和广告账户授权。',
  rate_limit: 'Meta 请求已被限流，请稍后重试；不需要反复重新授权。',
  timeout: 'Meta 请求超时，请检查原工具到 Meta 的网络；不代表授权失效。',
  network: '原工具无法完成 Meta 网络请求，请检查网络或代理。',
  upstream: 'Meta 返回服务错误，请稍后检测；不要重复提交广告修改。',
  validation: 'Meta 请求或对象校验失败，请检查对象及请求配置。',
  unknown: '原工具校验失败，未返回可识别的 Meta 错误码，请检查服务日志。',
} as const;
export interface MetaFailure {
  category: keyof typeof META_FAILURE_MESSAGES;
  message: string;
  code?: number;
  subcode?: number;
  httpStatus?: number;
}
const errorNumber = (v: unknown) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 999999999
    ? v
    : undefined;
export function sanitizeMetaFailure(value: unknown): MetaFailure | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  if (
    typeof data.category !== 'string' ||
    !Object.prototype.hasOwnProperty.call(META_FAILURE_MESSAGES, data.category)
  )
    return undefined;
  const category = data.category as MetaFailure['category'];
  const http = errorNumber(data.httpStatus);
  return {
    category,
    message: META_FAILURE_MESSAGES[category],
    code: errorNumber(data.code),
    subcode: errorNumber(data.subcode),
    httpStatus: http && http >= 100 && http <= 599 ? http : undefined,
  };
}
/** Parse only the original Graph client's numeric prefix. Never return its raw
 * message, URL, request parameters, token, response body or stack. */
export function metaFailure(error: unknown): MetaFailure {
  const text = error instanceof Error ? error.message : '';
  const match = /^#(\d{1,9})(?:\/(\d{1,9}))?(?:\s|$)/.exec(text);
  const code = match ? Number(match[1]) : undefined;
  const subcode = match?.[2] ? Number(match[2]) : undefined;
  const httpMatch = /Meta API[^\n]*HTTP (\d{3})/.exec(text);
  const httpStatus = httpMatch ? Number(httpMatch[1]) : undefined;
  let category: MetaFailure['category'] = 'unknown';
  if (code === 190 || code === 102) category = 'authentication';
  else if (code === 10 || (code !== undefined && code >= 200 && code <= 299))
    category = 'permission';
  else if ([4, 17, 32, 613, 80004].includes(code || 0) || httpStatus === 429)
    category = 'rate_limit';
  else if (
    (error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name)) ||
    /timed?\s*out|timeout/i.test(text)
  )
    category = 'timeout';
  else if (
    /fetch failed|failed to fetch|ECONNRESET|ENOTFOUND|ECONNREFUSED/i.test(text)
  )
    category = 'network';
  else if (code === 1 || code === 2 || (httpStatus && httpStatus >= 500))
    category = 'upstream';
  else if (code !== undefined) category = 'validation';
  return {
    category,
    message: META_FAILURE_MESSAGES[category],
    code,
    subcode,
    httpStatus,
  };
}

/** Display-only Graph reads: scope must be a credential fingerprint, never a token.
 * Preflight, apply and readback must use the original uncached Graph function. */
export function createMetaDisplayReader() {
  const cache = new Map<
    string,
    { until: number; value: Record<string, unknown> }
  >();
  const pending = new Map<string, Promise<Record<string, unknown>>>();
  let generation = 0;
  let running = 0;
  const waiting: (() => void)[] = [];
  return {
    clear() {
      generation++;
      cache.clear();
      pending.clear();
    },
    async read(
      scope: string,
      graph: MetaGraphCall,
      path: string,
      params: Record<string, string>,
    ) {
      const key = JSON.stringify([scope, path, Object.entries(params).sort()]);
      const hit = cache.get(key);
      if (hit && hit.until > Date.now()) return hit.value;
      if (pending.has(key)) return pending.get(key)!;
      if (waiting.length >= 100)
        throw new Error('Meta 只读请求繁忙，请稍后重试');
      const epoch = generation;
      const task = (async () => {
        if (running >= 4)
          await new Promise<void>((resolve) => waiting.push(resolve));
        else running++;
        try {
          const value = await graph(path, params);
          if (epoch === generation) {
            cache.delete(key);
            cache.set(key, {
              value,
              until: Date.now() + (path === 'me' ? 15000 : 60000),
            });
            while (cache.size > 1000) cache.delete(cache.keys().next().value!);
          }
          return value;
        } finally {
          const next = waiting.shift();
          if (next) next();
          else running--;
        }
      })();
      pending.set(key, task);
      try {
        return await task;
      } finally {
        if (pending.get(key) === task) pending.delete(key);
      }
    },
  };
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
  let failure: unknown;
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (queue.length && !failure) {
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
        } catch (error) {
          if (
            [
              'authentication',
              'rate_limit',
              'timeout',
              'network',
              'upstream',
            ].includes(metaFailure(error).category)
          )
            failure = error;
          else unavailable.push(id);
        }
      }
    }),
  );
  if (failure) throw failure;
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
