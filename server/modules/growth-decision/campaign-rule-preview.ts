import type {
  CampaignDailySnapshot,
  CampaignRulesPreview,
  GrowthProduct,
} from '@shared/api.interface';
import { buildCampaignCard } from './campaign-decision-engine';
import { reconcileCampaignHistory } from './campaign-history';
import { campaignHash } from './campaign-snapshots';

export function previewRules(
  product: GrowthProduct,
  rules: NonNullable<GrowthProduct['campaignRules']>,
  snapshots: CampaignDailySnapshot[],
): CampaignRulesPreview {
  const items: CampaignRulesPreview['items'] = [];
  let urgentBefore = 0,
    urgentAfter = 0;
  for (const { snapshots: history } of reconcileCampaignHistory(snapshots)) {
    const dates = [...new Set(history.map((s) => s.dataDate))]
      .sort()
      .reverse()
      .slice(0, 7);
    for (const date of dates) {
      const at = new Date(Date.parse(`${date}T00:00:00+08:00`) + 86400000);
      // Retrospective replay, not a claim that these snapshots were available then.
      const input = history
        .filter((s) => s.dataDate <= date)
        .map((s) => ({ ...s, fetchedAt: at.toISOString() }));
      const before = buildCampaignCard(product, input, [], at);
      const after = buildCampaignCard(
        { ...product, campaignRules: rules },
        input,
        [],
        at,
      );
      const matches = rules.filter(
        (r) =>
          r.enabled &&
          buildCampaignCard({ ...product, campaignRules: [r] }, input, [], at)
            .matchedRule?.id === r.id,
      );
      urgentBefore += Number(Boolean(before.urgent));
      urgentAfter += Number(Boolean(after.urgent));
      items.push({
        key: after.key,
        name: after.snapshot.campaignName,
        date,
        before: before.verdict,
        after: after.verdict,
        blockers: after.blockers,
        winner: after.matchedRule?.name,
        conflicts: matches.length > 1 ? matches.map((r) => r.name) : [],
      });
    }
  }
  return {
    token: campaignHash([product, rules, snapshots]),
    evaluated: items.length,
    changed: items.filter((i) => i.before !== i.after).length,
    urgentBefore,
    urgentAfter,
    items,
  };
}
