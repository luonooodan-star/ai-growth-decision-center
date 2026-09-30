import type { BiPart, BiRawRow } from './paid-growth.interface';

export const normalizePaidMedia = (source: string): string => {
  const value = source.trim();
  const lower = value.toLowerCase();
  if (lower === 'facebook web' || lower === 'facebook-web')
    return 'facebook_web';
  if (lower === 'facebook' || lower === 'facebook_web') return lower;
  return value;
};

export const isFacebookMedia = (source: string): boolean =>
  ['facebook', 'facebook_web'].includes(normalizePaidMedia(source));

/** W2A campaigns are Web even when Doris labels their source as Facebook. */
export function paidMediaChannel(row: BiRawRow): string {
  const source = normalizePaidMedia(String(row.media_source || ''));
  if (isFacebookMedia(source) && /w2a/i.test(String(row.campaign_name || '')))
    return 'facebook_web';
  return source;
}

const campaignKey = (row: BiRawRow): string =>
  JSON.stringify([String(row.app_id || ''), String(row.campaign_id || '')]);

/** Daily spend names anchor the channel when cohort rows carry an older name. */
export function campaignMediaById(rows: BiRawRow[]): Map<string, string> {
  const channels = new Map<string, string>();
  for (const row of rows) {
    if (
      !row.campaign_id ||
      !row.campaign_name ||
      !isFacebookMedia(String(row.media_source || ''))
    )
      continue;
    const key = campaignKey(row);
    const channel = paidMediaChannel(row);
    if (channel === 'facebook_web' || !channels.has(key))
      channels.set(key, channel);
  }
  return channels;
}

/** Keep source caches raw; classify only the response for its requested scope. */
export function classifiedMediaPart(
  part: BiPart,
  media = '',
  campaignChannels?: Map<string, string>,
): BiPart {
  const selected = media ? normalizePaidMedia(media) : '';
  const rows = part.rows
    .map((row) => ({
      ...row,
      media_source:
        (isFacebookMedia(String(row.media_source || '')) &&
          campaignChannels?.get(campaignKey(row))) ||
        paidMediaChannel(row),
    }))
    .filter((row) => !selected || row.media_source === selected);
  return { ...part, rows };
}
