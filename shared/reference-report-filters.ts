export const REPORT_BUYERS = ['lzx', 'jsa', 'fjx'] as const;
export const REPORT_CHANNEL_NAMES: Record<string, string> = {
  facebook: 'FB',
  tiktok: 'TT',
  'google ads': 'Google Ads',
};
export const REPORT_ALLOWED: Record<string, string[]> = {
  lzx: ['facebook', 'tiktok'],
  jsa: ['facebook', 'google ads'],
  fjx: ['facebook', 'tiktok'],
};
export function reportChannel(value: string): string {
  const name = value.trim().toLowerCase();
  if (
    [
      'facebook',
      'facebook_web',
      'facebook web',
      'facebook ads',
      'meta',
      'meta ads',
    ].includes(name)
  )
    return 'facebook';
  if (
    ['tiktok', 'tiktok san', 'tiktok ads', 'bytedanceglobal_int'].includes(name)
  )
    return 'tiktok';
  if (
    ['google ads', 'google', 'googleadwords_int', 'google_ads'].includes(name)
  )
    return 'google ads';
  return name;
}
export function reportChannels(buyer: string): string[] {
  return REPORT_ALLOWED[buyer] || Object.keys(REPORT_CHANNEL_NAMES);
}
export function matchesReferenceReport(
  row: { buyer: string; channel: string; date: string; platform: string },
  scope: {
    buyer: string;
    channel: string;
    start: string;
    end: string;
    platform: string;
  },
): boolean {
  const channel = reportChannel(row.channel);
  return (
    !!REPORT_ALLOWED[row.buyer]?.includes(channel) &&
    (!scope.buyer || row.buyer === scope.buyer) &&
    (!scope.channel || channel === scope.channel) &&
    (scope.platform === 'all' || row.platform === scope.platform) &&
    row.date >= scope.start &&
    row.date <= scope.end
  );
}
