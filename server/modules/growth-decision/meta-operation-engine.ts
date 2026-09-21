import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type {
  MetaOperation,
  MetaOperationInput,
  MetaOperationReview,
  CampaignDailySnapshot,
} from '@shared/api.interface';

export function normalizeMetaOperation(value: unknown): MetaOperation {
  if (!value || typeof value !== 'object')
    throw new BadRequestException('操作记录格式错误');
  const row = value as Record<string, unknown>;
  for (const key of ['accountId', 'objectId', 'actorId']) {
    if (typeof row[key] !== 'string' || !/^\d{1,40}$/.test(row[key] as string))
      throw new BadRequestException(`${key} 必须为数字字符串，禁止浮点 ID`);
  }
  if (
    row.campaignId !== undefined &&
    (typeof row.campaignId !== 'string' || !/^\d{1,40}$/.test(row.campaignId))
  )
    throw new BadRequestException('campaignId 无效');
  for (const key of [
    'objectName',
    'actorName',
    'eventType',
    'occurredAt',
    'accountTimezone',
    'raw',
  ]) {
    if (
      typeof row[key] !== 'string' ||
      !(row[key] as string).trim() ||
      (row[key] as string).length > 24000
    )
      throw new BadRequestException(`${key} 缺失或过长`);
  }
  for (const key of [
    'objective',
    'optimizationGoal',
    'conversionEvent',
    'campaignName',
  ]) {
    if (
      row[key] !== undefined &&
      (typeof row[key] !== 'string' || (row[key] as string).length > 500)
    )
      throw new BadRequestException(`${key} 无效`);
  }
  if (
    !['campaign', 'adset', 'ad', 'account'].includes(String(row.objectLevel)) ||
    ![
      'budget',
      'status',
      'targeting',
      'bid',
      'creative',
      'optimization',
      'created',
      'other',
    ].includes(String(row.field)) ||
    typeof row.systemActor !== 'boolean'
  )
    throw new BadRequestException('操作类型无效');
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(
      String(row.occurredAt),
    ) ||
    !Number.isFinite(Date.parse(String(row.occurredAt))) ||
    Date.parse(String(row.occurredAt)) > Date.now() + 300000
  )
    throw new BadRequestException('操作时间必须包含时区，且不能在未来');
  try {
    new Intl.DateTimeFormat('en', {
      timeZone: String(row.accountTimezone),
    }).format();
  } catch {
    throw new BadRequestException('账户时区无效');
  }
  for (const key of ['before', 'after']) {
    const v = row[key];
    if (
      v !== undefined &&
      !(typeof v === 'string' && v.length <= 4000) &&
      !(typeof v === 'number' && Number.isFinite(v))
    )
      throw new BadRequestException(`${key} 无效`);
  }
  const input = row as unknown as MetaOperationInput;
  const occurredAt = new Date(input.occurredAt).toISOString();
  // Stable across overlapping windows, retries and enrichment. Raw JSON string is audit only.
  const id = createHash('sha256')
    .update(
      JSON.stringify([
        input.accountId,
        input.objectId,
        input.actorId,
        occurredAt,
        input.eventType,
        input.field,
        input.before ?? null,
        input.after ?? null,
      ]),
    )
    .digest('hex');
  let category: MetaOperation['category'] = 'other';
  let changePct: number | undefined;
  if (
    !input.systemActor &&
    input.field === 'budget' &&
    typeof input.before === 'number' &&
    typeof input.after === 'number' &&
    input.before > 0 &&
    input.after >= 0 &&
    input.after !== input.before
  ) {
    changePct = (input.after / input.before - 1) * 100;
    category = changePct > 0 ? 'increase' : 'decrease';
  } else if (
    !input.systemActor &&
    input.field === 'status' &&
    input.before !== input.after &&
    ['PAUSED', 'ARCHIVED', 'DELETED'].includes(
      String(input.after).toUpperCase(),
    )
  )
    category = 'pause';
  else if (
    !input.systemActor &&
    ['targeting', 'bid', 'creative', 'optimization'].includes(input.field) &&
    input.before !== undefined &&
    input.after !== undefined &&
    input.before !== input.after
  )
    category = 'adjust';
  return {
    ...input,
    source: 'meta_import',
    adjustmentJobId: undefined,
    capturedEvidence: undefined,
    id,
    occurredAt,
    importedAt: new Date().toISOString(),
    category,
    changePct,
    linked: false,
  };
}

export function dataDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Shanghai',
  });
}

export function reviewMetaOperation(
  operation: MetaOperation,
  snapshots: CampaignDailySnapshot[],
  operations: MetaOperation[],
  now = new Date(),
): MetaOperationReview {
  const day = dataDay(operation.occurredAt);
  const addDays = (n: number): string =>
    new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000)
      .toISOString()
      .slice(0, 10);
  const history = snapshots
    .filter(
      (s) =>
        s.campaignId === operation.campaignId &&
        s.accountId === operation.accountId,
    )
    .sort((a, b) => a.dataDate.localeCompare(b.dataDate));
  const before = history.filter(
    (s) => s.dataDate >= addDays(-3) && s.dataDate < day,
  );
  const after = history.filter(
    (s) =>
      s.dataDate > day &&
      s.dataDate <= addDays(7) &&
      s.dataDate < dataDay(now.toISOString()),
  );
  const intervening = operations
    .filter(
      (o) =>
        o.id !== operation.id &&
        o.category !== 'other' &&
        o.accountId === operation.accountId &&
        o.campaignId === operation.campaignId &&
        o.occurredAt >= operation.occurredAt &&
        dataDay(o.occurredAt) <= addDays(7),
    )
    .map((o) => o.id);
  let summary = !operation.linked
    ? '尚未匹配唯一产品与账户快照；不猜测归属'
    : !before.length || !after.length
      ? '等待操作前后完整日数据；不将缺失值当作 0'
      : before.some((s) => s.qualityIssues.length) ||
          after.some((s) => s.qualityIssues.length)
        ? '数据完整性未通过，暂不判断改善'
        : intervening.length
          ? '期间存在其他操作，不能将变化单独归因于本次调整'
          : '已关联操作前后数据，需结合样本和同期环境复盘；相关性不等于因果';
  if (operation.category === 'other')
    summary = '审计记录：系统事件、新建初始化或不支持的操作不自动生成实验';
  const baseline = before.at(-1);
  const latest = after.at(-1);
  if (operation.category !== 'other' && baseline && latest) {
    const a = baseline.metrics.d0_roas,
      b = latest.metrics.d0_roas;
    if (
      !baseline.qualityIssues.length &&
      !latest.qualityIssues.length &&
      typeof a === 'number' &&
      typeof b === 'number' &&
      Number.isFinite(a) &&
      Number.isFinite(b)
    ) {
      const pp = (b - a) * 100;
      summary = `D0 ROAS：${baseline.dataDate} ${(a * 100).toFixed(2)}% → ${latest.dataDate} ${(b * 100).toFixed(2)}%，变化 ${pp > 0 ? '+' : ''}${pp.toFixed(2)} 个百分点。${summary}。尚未据此认定样本充分或措施有效。`;
    }
  }
  return {
    operation,
    before,
    after,
    intervening,
    summary:
      (operation.source === 'adjustment_page'
        ? `${operation.capturedEvidence?.note || '历史调整未留存提交时 Doris 快照，不倒填操作前证据。'} `
        : '') + summary,
    dataTimezone: 'Asia/Shanghai',
    comparisonScope: 'campaign',
  };
}
