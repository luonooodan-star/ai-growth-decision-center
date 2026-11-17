import { normalizePaidMedia } from './paid-media-channel';
import type { RoasRow } from './roas-report';
export const roasChannel = (source: string) => normalizePaidMedia(source);
export function roasChannelLabel(channel: string): string {
  const value = roasChannel(channel);
  return (
    (
      {
        facebook: 'FB',
        facebook_web: 'Facebook Web',
        tiktok: 'TT',
        'google ads': 'Google Ads',
      } as Record<string, string>
    )[value.toLowerCase()] || value
  );
}
export function roasReportChannels(
  catalog: { appId: number; channel: string }[],
  rows: { appId: number; channel: string }[],
  platform: string,
): string[] {
  const channels = new Map<string, string>();
  for (const row of [...catalog, ...rows]) {
    if (
      ![3, 12].includes(row.appId) ||
      (platform !== 'all' && row.appId !== (platform === 'ios' ? 3 : 12))
    )
      continue;
    const channel = roasChannel(row.channel);
    if (channel && !channels.has(channel.toLowerCase()))
      channels.set(channel.toLowerCase(), channel);
  }
  return [...channels.values()].sort();
}
export function matchesRoasReport(
  row: RoasRow,
  scope: {
    buyer: string;
    channel: string;
    platform: string;
    start: string;
    end: string;
  },
): boolean {
  return (
    (!scope.buyer || row.buyer === scope.buyer) &&
    (!scope.channel ||
      roasChannel(row.channel).toLowerCase() ===
        roasChannel(scope.channel).toLowerCase()) &&
    (scope.platform === 'all' ||
      row.appId === (scope.platform === 'ios' ? 3 : 12)) &&
    row.date >= scope.start &&
    row.date <= scope.end
  );
}
