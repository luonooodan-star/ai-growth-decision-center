function identity(date, channel, country, id, name) {
  return JSON.stringify([date, channel, country, String(id ?? ''), name || '']);
}

export function campaignGroups(assetId, facts, cohorts, cutoff) {
  const groups = new Map();
  const owners = new Map();
  const links = new Map();
  for (const fact of facts) {
    if (fact.bucket !== 'single' || !fact.asset_id) continue;
    const key = identity(fact.date, fact.channel, fact.country, fact.creative_id, fact.creative_name);
    if (!owners.has(key)) owners.set(key, fact.asset_id);
    else if (owners.get(key) !== fact.asset_id) owners.set(key, null);
    if (fact.asset_id !== assetId) continue;
    const dimensions = fact.source_dimensions || {};
    const id = String(dimensions.campaign_id ?? '');
    const name = dimensions.campaign_name || id || '未知系列';
    const groupKey = JSON.stringify([fact.channel, id || name]);
    if (!groups.has(groupKey)) groups.set(groupKey, {name, channel:fact.channel || '未知平台', facts:[], windows:{}});
    const group = groups.get(groupKey);
    group.facts.push(fact);
    if (id) links.set(JSON.stringify([key, id]), group);
  }
  const seen = new Set();
  for (const r of cohorts) {
    const key = identity(r.install_date, r.media_source, r.country_code, r.creative_id, r.creative_name);
    if (owners.get(key) !== assetId) continue;
    const group = links.get(JSON.stringify([key, String(r.campaign_id ?? '')]));
    if (!group || r.match_status !== 'matched' || r.metric_id !== 'revenue' || r.cohort_unit !== 'D') continue;
    if (!['1','true'].includes(String(r.observation_complete).toLowerCase())) continue;
    const maturity = Date.parse(r.install_date) + Number(r.cohort_index) * 86400000;
    if (!(maturity <= Date.parse(cutoff)) || r.cumulative_metric_value == null || !(Number(r.cohort_spend) > 0)) continue;
    const recordKey = JSON.stringify([key,r.campaign_id,r.adgroup_id,r.cohort_index]);
    if (seen.has(recordKey)) continue;
    seen.add(recordKey);
    const value = group.windows[r.cohort_index] ||= {spend:0,revenue:0};
    value.spend += Number(r.cohort_spend);
    value.revenue += Number(r.cumulative_metric_value);
  }
  return [...groups.values()];
}
