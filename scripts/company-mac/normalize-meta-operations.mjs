#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Parse only values; nested numeric IDs in extra_data are never used for joins.
const scalar = (value) =>
  value === null || value === undefined
    ? undefined
    : typeof value === 'number' || typeof value === 'string'
      ? value
      : JSON.stringify(value);
const id = (value) => {
  if (typeof value !== 'string' || !/^\d+$/.test(value))
    throw new Error('Meta ID 必须保留为字符串');
  return value;
};

export function accountTimeToIso(value, timezone) {
  const match = String(value).match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) throw new Error(`不支持的 Meta 时间格式：${value}`);
  const parts = match.slice(1).map((x) => Number(x || 0));
  const wall = Date.UTC(
    parts[0],
    parts[1] - 1,
    parts[2],
    parts[3],
    parts[4],
    parts[5],
  );
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const localWall = (timestamp) => {
    const p = Object.fromEntries(
      formatter.formatToParts(timestamp).map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
  };
  const offsets = [
    ...new Set(
      [-86400000, 0, 86400000].map(
        (delta) => localWall(wall + delta) - (wall + delta),
      ),
    ),
  ];
  const candidates = offsets
    .map((offset) => wall - offset)
    .filter((timestamp) => localWall(timestamp) === wall);
  if (candidates.length !== 1)
    throw new Error('账户夏令时导致操作时间不存在或歧义，需精确时间戳后再导入');
  return new Date(candidates[0]).toISOString();
}

export function normalizeMetaLogs(
  accountId,
  timezone,
  logs,
  sourceEntities,
  fetchedAt = new Date().toISOString(),
) {
  id(accountId);
  if (!Array.isArray(logs)) throw new Error('logs 必须为原始日志数组');
  const entities = ['campaign', 'adset', 'ad'].flatMap((level) =>
    (sourceEntities[level] || []).map((e) => ({
      accountId,
      id: id(e.id),
      campaignId: level === 'campaign' ? id(e.id) : id(e.campaign_id),
      level,
      name: String(e.name || e.id),
      adsetId: level === 'ad' && e.adset_id ? id(e.adset_id) : undefined,
      objective: e.objective,
      optimizationGoal: e.optimization_goal,
      // Only explicit event fields, never billing_event or a name-based inference.
      conversionEvent: e.promoted_object?.custom_event_type,
      conversionEventStatus: e.promoted_object?.custom_event_type ? 'returned'
        : Object.hasOwn(e, 'promoted_object') &&
          (e.promoted_object === null || Object.keys(e.promoted_object || {}).length === 0)
          ? 'not_configured' : undefined,
      fetchedAt,
    })),
  );
  const created = new Set(
    logs
      .filter((r) => /创建|^create/i.test(r.event_type))
      .map((r) => `${r.object_id}:${r.datetime}`),
  );
  const operations = logs.map((r) => {
    const extra = JSON.parse(r.extra_data || '{}');
    const entity = entities.find((e) => e.id === r.object_id);
    const event = String(r.event_type || 'unknown');
    const level =
      entity?.level ||
      (/广告系列|campaign/i.test(event)
        ? 'campaign'
        : /广告组|ad.?set/i.test(event)
          ? 'adset'
          : /^广告|\bad\b/i.test(event)
            ? 'ad'
            : 'account');
    let field = 'other';
    let before = scalar(extra.old_value),
      after = scalar(extra.new_value);
    if (created.has(`${r.object_id}:${r.datetime}`)) field = 'created';
    else if (
      /预算已更新|budget.*(?:update|change)/i.test(event) &&
      extra.old_value?.type === 'payment_amount' &&
      extra.new_value?.type === 'payment_amount' &&
      extra.old_value.currency === extra.new_value.currency
    ) {
      field = 'budget';
      before = extra.old_value.old_value;
      after = extra.new_value.new_value;
    } else if (/状态|status/i.test(event)) {
      field = 'status';
      const statuses = {
        已暂停: 'PAUSED',
        投放中: 'ACTIVE',
        已删除: 'DELETED',
        已归档: 'ARCHIVED',
        待处理: 'PENDING',
      };
      before = statuses[before] || before;
      after = statuses[after] || after;
    } else if (/受众|target/i.test(event)) field = 'targeting';
    else if (/竞价|\bbid/i.test(event)) field = 'bid';
    else if (/优化目标|optimization/i.test(event)) field = 'optimization';
    // Empty previous settings indicate initialization, not an optimizer adjustment.
    if (before === '[]' || before === '{}' || before === '') before = undefined;
    const campaignId =
      level === 'campaign' ? id(r.object_id) : entity?.campaignId;
    return {
      accountId,
      campaignId,
      campaignName: entities.find(
        (e) => e.level === 'campaign' && e.id === campaignId,
      )?.name,
      objectId: id(r.object_id),
      objectName: String(r.object_name || r.object_id),
      objectLevel: level,
      actorId: id(r.actor_id),
      actorName: String(r.actor_name || r.actor_id),
      systemActor: /^(Meta|Facebook)$/i.test(r.actor_name),
      occurredAt: accountTimeToIso(r.datetime, timezone),
      accountTimezone: timezone,
      eventType: event,
      field,
      before,
      after,
      raw: JSON.stringify(r),
    };
  });
  return { operations, entities };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [accountId, timezone, logsPath, entitiesPath, outputPath] =
    process.argv.slice(2);
  if (!outputPath)
    throw new Error(
      '用法：normalize-meta-operations.mjs <accountId> <timezone> <logs.json> <entities.json> <output.json>',
    );
  const payload = normalizeMetaLogs(
    accountId,
    timezone,
    JSON.parse(await readFile(logsPath, 'utf8')),
    JSON.parse(await readFile(entitiesPath, 'utf8')),
  );
  if (!/^\/private\/tmp\/codex-growth-[a-zA-Z0-9_-]+\.json$/.test(outputPath)) throw new Error('输出必须位于 /private/tmp/codex-growth-*.json');
  const batches = [];
  let batch = { operations: [], entities: [] };
  for (const key of ['entities', 'operations']) {
    for (const item of payload[key]) {
      const candidate = { ...batch, [key]: [...batch[key], item] };
      if (candidate[key].length > 500 || Buffer.byteLength(JSON.stringify(candidate)) > 80000) {
        if (!batch.operations.length && !batch.entities.length) throw new Error('单条 Meta 记录过大，未截断，请核对');
        batches.push(batch); batch = { operations: [], entities: [] };
      }
      batch[key].push(item);
      if (Buffer.byteLength(JSON.stringify(batch)) > 80000) throw new Error('单条 Meta 记录过大，未截断，请核对');
    }
  }
  if (batch.operations.length || batch.entities.length) batches.push(batch);
  const files = [];
  for (let i = 0; i < batches.length; i++) {
    const path = outputPath.replace(/\.json$/, `-${i}.json`);
    await writeFile(path, JSON.stringify(batches[i]), { mode: 0o600 }); files.push(path);
  }
  process.stdout.write(JSON.stringify({ operations: payload.operations.length, entities: payload.entities.length, files }) + '\n');
}
