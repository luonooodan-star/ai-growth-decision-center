import type { BiRawRow } from '@shared/paid-growth.interface';
import type { CreativeFunnelRow } from '@shared/creative-analysis.interface';
import {
  buildCreativeFunnelRows,
  type FunnelCohortUser,
} from './creative-funnel';
/** Epoch timestamps or ISO instants only; never parse a naive local date in the host timezone. */
export function shanghaiEventHour(value: unknown, date: string): number {
  let ms: number;
  const text = String(value ?? '');
  if (/^\d{10}(?:\.\d+)?$/.test(text)) ms = Number(text) * 1000;
  else if (/^\d{13}$/.test(text)) ms = Number(text);
  else if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) ms = Date.parse(text);
  else
    throw new Error(
      '事件时间缺失或未携带时区，无法确认东八区小时；未生成小时数据',
    );
  const shifted = new Date(ms + 8 * 3600000);
  if (!Number.isFinite(ms) || shifted.toISOString().slice(0, 10) !== date)
    throw new Error('事件时间与东八区查询日期不一致，未生成小时数据');
  return shifted.getUTCHours();
}
export function buildBehaviorHourlyRows(
  cohort: FunnelCohortUser[],
  events: BiRawRow[] | null,
  attribution: BiRawRow[] | null,
  now = new Date(),
  behaviorEvents?: Record<string, string[]>,
): CreativeFunnelRow[] {
  if (events === null) throw new Error('行为事件读取失败，无法生成小时数据');
  const byHour = new Map<number, BiRawRow[]>();
  for (const row of events) {
    const h = shanghaiEventHour(
      row.event_timestamp,
      String(row.event_date).slice(0, 10),
    );
    byHour.set(h, [...(byHour.get(h) || []), row]);
  }
  const current = new Date(now.getTime() + 8 * 3600000);
  const dateNow = current.toISOString().slice(0, 10);
  return Array.from({ length: 24 }, (_, hour) =>
    buildCreativeFunnelRows(cohort, {
      events: byHour.get(hour) || [],
      attribution,
      orders: null,
      behaviorEvents,
    }).map((row) => ({ ...row, hour, key: JSON.stringify([row.key, hour]) })),
  )
    .flat()
    .filter(
      (row) =>
        row.date < dateNow ||
        (row.date === dateNow && row.hour! <= current.getUTCHours()),
    );
}
