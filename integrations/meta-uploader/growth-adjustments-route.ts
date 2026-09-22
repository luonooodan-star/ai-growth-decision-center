// Installed as app/api/meta/growth-adjustments/route.ts in the original uploader.
import { getMetaToken, graph, requestOrigin } from '../../../../lib/meta';
import {
  adjustmentBudgetUnits,
  resolveCampaignAccounts,
  createMetaDisplayReader,
  metaFailure,
  adjustmentSnapshotMatches,
  readAdjustmentSnapshot,
  validateAdjustmentChange,
  type MetaAdjustmentChange,
  type MetaAdjustmentTarget,
  type MetaGraphCall,
} from '../../../../lib/growth-adjustment-contract';

const displayReader = createMetaDisplayReader();

export async function POST(request: Request) {
  if (request.headers.get('origin') !== requestOrigin(request))
    return Response.json({ error: '请求来源无效' }, { status: 403 });
  const token = await getMetaToken(request);
  if (!token)
    return Response.json(
      { error: '请先在原广告工具登录 Meta' },
      { status: 401 },
    );
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(35000)]);
  const direct: MetaGraphCall = (path, params, post = false) =>
    graph(path, token, post ? {} : params, {
      signal,
      ...(post ? { method: 'POST', body: new URLSearchParams(params) } : {}),
    });
  let mutating = false;
  try {
    const body = (await request.json()) as {
      action: string;
      target: MetaAdjustmentTarget;
      change: MetaAdjustmentChange;
      ownerId?: string;
      accountIds?: string[];
      campaignIds?: string[];
    };
    mutating = body.action === 'apply';
    if (mutating) displayReader.clear();
    // Hash in memory only; the original tool still owns all login/key handling.
    const scope = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
      ),
    )
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    const displayOnly =
      !body.ownerId &&
      ['read', 'resolve-ad', 'campaign-accounts', 'account-names'].includes(
        body.action,
      );
    const call: MetaGraphCall = displayOnly
      ? (path, params, post = false) => {
          if (post) throw new Error('只读缓存不允许写入');
          return displayReader.read(scope, direct, path, params);
        }
      : direct;
    const profile = await call('me', { fields: 'id' });
    const ownerId = String(profile.id || '');
    if (!ownerId || (body.ownerId && body.ownerId !== ownerId))
      throw new Error('Meta 登录用户已变化，请重新预检');
    if (body.action === 'identity') return Response.json({ ownerId });
    if (body.action === 'campaign-accounts')
      return Response.json({
        ownerId,
        ...(await resolveCampaignAccounts(body.campaignIds!, call)),
      });
    if (body.action === 'account-names') {
      const ids = body.accountIds;
      if (
        !Array.isArray(ids) ||
        ids.length > 10 ||
        ids.some((id) => !/^\d{1,40}$/.test(id))
      )
        throw new Error('广告账户 ID 无效');
      const accounts: { id: string; name: string }[] = [];
      const queue = [...new Set(ids)];
      await Promise.all(
        Array.from({ length: 2 }, async () => {
          while (queue.length) {
            const id = queue.shift()!;
            try {
              const account = await call(`act_${id}`, {
                fields: 'account_id,name',
              });
              if (
                String(account.account_id) === id &&
                typeof account.name === 'string'
              )
                accounts.push({ id, name: account.name });
            } catch {
              /* An inaccessible name must not hide the Doris account ID. */
            }
          }
        }),
      );
      return Response.json({ accounts });
    }
    if (body.action === 'read')
      return Response.json({
        ownerId,
        snapshot: await readAdjustmentSnapshot(body.target, call),
      });
    if (body.action === 'resolve-ad') {
      const target = body.target;
      // Verify adset ownership before inspecting the ads edge; a creative can be shared by multiple ads.
      await readAdjustmentSnapshot(
        { ...target, id: target.adsetId || '', level: 'adset' },
        call,
      );
      const found: MetaAdjustmentTarget[] = [];
      let after = '';
      for (let page = 0; page < 100; page++) {
        const data = await call(`${target.adsetId}/ads`, {
          fields: 'id,creative{id}',
          limit: '100',
          ...(after ? { after } : {}),
        });
        for (const ad of (data.data || []) as {
          id: string;
          creative?: { id: string };
        }[]) {
          if (ad.id === target.id || ad.creative?.id === target.id)
            found.push({ ...target, id: ad.id, level: 'ad' });
        }
        const paging = data.paging as
          | { next?: string; cursors?: { after?: string } }
          | undefined;
        if (!paging?.next) {
          const snapshots = [];
          for (const item of found)
            snapshots.push(await readAdjustmentSnapshot(item, call));
          return Response.json({ ownerId, snapshots });
        }
        if (!paging.cursors?.after)
          throw new Error('广告映射分页不完整，已阻止操作');
        after = paging.cursors.after;
      }
      throw new Error('广告映射超过上限，不能确认目标');
    }
    if (body.action !== 'apply') throw new Error('不支持的操作');
    validateAdjustmentChange(body.change);
    const before = await readAdjustmentSnapshot(body.change.before, call);
    if (!adjustmentSnapshotMatches(before, body.change.before))
      throw new Error('当前状态或预算已变化，请重新预检');
    if (!['ACTIVE', 'PAUSED'].includes(before.status))
      throw new Error('该对象已归档或删除，不允许操作');
    const params: Record<string, string> = {};
    if (body.change.status) params.status = body.change.status;
    if (body.change.dailyBudget !== undefined) {
      if (!before.budgetEditable)
        throw new Error(before.budgetReason || '该层级不能修改预算');
      params.daily_budget = adjustmentBudgetUnits(body.change.dailyBudget);
    }
    // No retries after a mutation: network ambiguity must be reconciled by a human.
    let result: Record<string, unknown>;
    try {
      result = await call(before.id, params, true);
    } catch {
      return Response.json(
        {
          error: '提交结果不确定，请核对 Meta 状态；禁止直接重试',
          uncertain: true,
        },
        { status: 502 },
      );
    }
    if (result.success !== true)
      return Response.json(
        { error: 'Meta 未确认成功，请核对后处理', uncertain: true },
        { status: 502 },
      );
    try {
      const after = await readAdjustmentSnapshot(before, call);
      if (
        (params.status && after.status !== params.status) ||
        (params.daily_budget && after.dailyBudget !== params.daily_budget)
      )
        throw new Error('readback mismatch');
      return Response.json({ ownerId, after });
    } catch {
      return Response.json(
        { error: 'Meta 已接收修改，但回读未确认，请人工核对', uncertain: true },
        { status: 502 },
      );
    }
  } catch (error) {
    const failure = metaFailure(error);
    return Response.json(
      {
        error: failure.message,
        metaFailure: failure,
      },
      { status: 400 },
    );
  } finally {
    if (mutating) displayReader.clear();
  }
}
