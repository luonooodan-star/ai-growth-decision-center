import type { BiPart } from './paid-growth.interface';
import { biNumber } from './paid-growth';

type Campaign = { appId: number; media: string; campaignId?: string };
const key = (c: Campaign) => JSON.stringify([c.appId, c.media, c.campaignId]);

/** Display-only: absence proves no spend only after every requested daily query is complete.
 * Never infer zero from missing metrics, failed reads, expired cache, or unknown identities.
 */
export function verifiedNoSpend(
  days: { date: string; daily: BiPart }[],
  expectedDates: string[],
): (campaign: Campaign) => boolean {
  if (!expectedDates.length) return () => false;
  const activity = new Map<string, boolean>();
  for (const date of expectedDates) {
    const matches = days.filter((d) => d.date === date);
    if (matches.length !== 1) return () => false;
    const daily = matches[0].daily;
    if (!['fresh', 'cached'].includes(daily.state)) return () => false;
    for (const row of daily.rows) {
      const appId = Number(row.app_id);
      const media = String(row.media_source || '');
      const campaignId = String(row.campaign_id || '');
      // A broken ID mapping might otherwise hide the corresponding revenue-only row.
      if (!Number.isFinite(appId) || appId <= 0 || !media || !campaignId)
        return () => false;
      const id = key({ appId, media, campaignId });
      const spend = biNumber(row.spend);
      activity.set(id, activity.get(id) || false || spend !== 0);
    }
  }
  return (campaign) => !!campaign.campaignId && !activity.get(key(campaign));
}
