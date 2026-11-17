import { paidMediaChannel } from './paid-media-channel';
import type { BiRawRow } from './paid-growth.interface';
export interface BuyerChannelOption {
  appId: number;
  buyer: string;
  channel: string;
  lastDate: string;
}
export function mergeBuyerChannelOptions(
  previous: BuyerChannelOption[],
  rows: BiRawRow[],
  queryEnd: string,
  now = new Date(),
): BuyerChannelOption[] {
  const oldest = new Date(now.getTime() + 8 * 3600000 - 89 * 86400000)
    .toISOString()
    .slice(0, 10);
  const found = new Map<string, BuyerChannelOption>();
  const add = (r: BuyerChannelOption) => {
    if (
      !r.buyer ||
      !r.channel ||
      !Number.isInteger(r.appId) ||
      r.appId <= 0 ||
      r.lastDate < oldest
    )
      return;
    const key = JSON.stringify([r.appId, r.buyer, r.channel.toLowerCase()]);
    const before = found.get(key);
    if (!before || before.lastDate < r.lastDate) found.set(key, r);
  };
  previous.forEach(add);
  for (const row of rows) {
    const buyer = String(row.buyer_alias || '').trim();
    if (
      !buyer ||
      ![
        'spend',
        'impressions',
        'media_clicks',
        'media_installs',
        'adjust_installs',
      ].some((metric) => Number(row[metric]) > 0)
    )
      continue;
    const date = String(row.report_date || queryEnd).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    add({
      appId: Number(row.app_id),
      buyer,
      channel: paidMediaChannel(row),
      lastDate: date,
    });
  }
  return [...found.values()].sort(
    (a, b) =>
      a.buyer.localeCompare(b.buyer) ||
      a.channel.localeCompare(b.channel) ||
      a.appId - b.appId,
  );
}
