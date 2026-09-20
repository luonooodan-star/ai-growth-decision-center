import type { CampaignDailySnapshot, MetaAdEntity } from '@shared/api.interface';

export interface CampaignHistoryGroup {
  snapshots: CampaignDailySnapshot[];
  relatedKeys: string[];
}

/** Read-time reconciliation only: source snapshots and order identities stay intact. */
export function reconcileCampaignHistory(
  snapshots: CampaignDailySnapshot[],
  entities: MetaAdEntity[] = [],
  channel = 'facebook',
): CampaignHistoryGroup[] {
  snapshots = snapshots.map(s => {
    if (channel.toLowerCase() !== 'facebook') return { ...s,
      qualityIssues: s.qualityIssues.filter(i => i !== '广告账户归属尚未唯一确认') };
    if (s.accountId || snapshots.some(other => other.productId === s.productId && other.campaignId === s.campaignId && other.accountId)) return s;
    const owners = [...new Set(entities.filter(e => e.campaignId === s.campaignId).map(e => e.accountId))];
    return owners.length === 1 ? { ...s, accountId: owners[0],
      qualityIssues: s.qualityIssues.filter(i => i !== '广告账户归属尚未唯一确认') } : s;
  });
  const groups = new Map<string, CampaignHistoryGroup>();
  for (const snapshot of snapshots) {
    const group = groups.get(snapshot.key) || {
      snapshots: [],
      relatedKeys: [snapshot.key],
    };
    group.snapshots.push(snapshot);
    groups.set(snapshot.key, group);
  }
  for (const [key, group] of groups) {
    if (group.snapshots.some((s) => s.accountId)) continue;
    const first = group.snapshots[0];
    const candidates = [...groups.values()].filter((candidate) =>
      candidate.snapshots.some(
        (s) =>
          s.productId === first.productId &&
          s.campaignId === first.campaignId &&
          Boolean(s.accountId),
      ),
    );
    // Never guess which account owns an unresolved series.
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];
    const accounts = new Set(candidate.snapshots.map((s) => s.accountId));
    if (accounts.size !== 1 || accounts.has(undefined)) continue;
    const covered = group.snapshots.every((old) =>
      candidate.snapshots.some(
        (fresh) =>
          fresh.productId === old.productId &&
          fresh.campaignId === old.campaignId &&
          fresh.dataDate === old.dataDate &&
          old.countries.length > 0 &&
          JSON.stringify([...new Set(fresh.countries)].sort()) ===
            JSON.stringify([...new Set(old.countries)].sort()) &&
          Date.parse(fresh.fetchedAt) >= Date.parse(old.fetchedAt) &&
          fresh.qualityIssues.length === 0 &&
          // A replacement must not make any previously available metric disappear.
          Object.entries(old.metrics).every(
            ([metric, value]) =>
              !Number.isFinite(value) ||
              Number.isFinite(
                fresh.metrics[metric as keyof typeof fresh.metrics],
              ),
          ),
      ),
    );
    if (!covered) continue;
    candidate.relatedKeys.push(...group.relatedKeys);
    groups.delete(key);
  }
  return [...groups.values()];
}
