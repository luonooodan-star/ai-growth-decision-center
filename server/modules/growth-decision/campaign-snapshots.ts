import { createHash } from 'node:crypto';
import type {
  CampaignDailySnapshot,
  GrowthDeliveryMetricValues,
  GrowthDiagnosticBreakdown,
} from '@shared/api.interface';
import {
  dorisNumber,
  dorisString,
  type DorisRow,
} from './doris-result-normalizer';

export function campaignHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 32);
}

export function aggregateCampaignMetrics(
  rows: DorisRow[],
): GrowthDeliveryMetricValues {
  const metrics: GrowthDeliveryMetricValues = {};
  const fields = [
    'spend',
    'impressions',
    'media_clicks',
    'media_installs',
    'adjust_installs',
    'adjust_revenue',
  ] as const;
  for (const field of fields) {
    const values: Array<number | undefined> = rows.map((row: DorisRow) =>
      dorisNumber(row, field),
    );
    if (
      values.length &&
      values.every(
        (v: number | undefined) => v !== undefined && Number.isFinite(v),
      )
    ) {
      metrics[field] = values.reduce<number>(
        (sum: number, v: number | undefined) => sum + (v ?? 0),
        0,
      );
    }
  }
  const ratio = (
    a: number | undefined,
    b: number | undefined,
  ): number | undefined =>
    a !== undefined && b !== undefined && b > 0 ? a / b : undefined;
  metrics.cpi = ratio(metrics.spend, metrics.adjust_installs);
  metrics.ctr = ratio(metrics.media_clicks, metrics.impressions);
  const cpm: number | undefined = ratio(metrics.spend, metrics.impressions);
  metrics.ecpm = cpm === undefined ? undefined : cpm * 1000;
  const ipm: number | undefined = ratio(
    metrics.media_installs,
    metrics.impressions,
  );
  metrics.ipm = ipm === undefined ? undefined : ipm * 1000;
  metrics.roas = ratio(metrics.adjust_revenue, metrics.spend);
  return metrics;
}

function groups(
  rows: DorisRow[],
  key: (row: DorisRow) => string,
): Map<string, DorisRow[]> {
  const result: Map<string, DorisRow[]> = new Map();
  for (const row of rows) {
    const value: string = key(row);
    if (value) result.set(value, [...(result.get(value) || []), row]);
  }
  return result;
}

function breakdown(
  rows: DorisRow[],
  dimension: GrowthDiagnosticBreakdown['dimension'],
  id: string,
  name: string,
): GrowthDiagnosticBreakdown[] {
  return Array.from(
    groups(rows, (row: DorisRow) => dorisString(row, id) || '').entries(),
  ).map(([value, items]: [string, DorisRow[]]) => ({
    dimension,
    value,
    label: dorisString(items[0], name) || value,
    metrics: aggregateCampaignMetrics(items),
  }));
}

/** 输入为已过滤产品/媒体/国家的数据。cohort 保持系列粒度，不能摊到广告组。 */
export function buildCampaignSnapshots(
  productId: string,
  delivery: DorisRow[],
  cohorts: DorisRow[],
  ads: DorisRow[],
  fetchedAt: string,
  issues: string[],
): CampaignDailySnapshot[] {
  const snapshots: CampaignDailySnapshot[] = [];
  const campaignAccounts: Map<string, Set<string>> = new Map();
  for (const row of [...delivery, ...ads]) {
    const campaign: string = dorisString(row, 'campaign_id') || '';
    const account: string = dorisString(row, 'advertiser_id') || '';
    if (campaign && account) {
      const values: Set<string> = campaignAccounts.get(campaign) || new Set();
      values.add(account);
      campaignAccounts.set(campaign, values);
    }
  }
  const daily: Map<string, DorisRow[]> = groups(delivery, (row: DorisRow) => {
    const campaign: string | undefined = dorisString(row, 'campaign_id');
    const date: string | undefined = dorisString(row, 'report_date');
    return campaign && date ? JSON.stringify([campaign, date]) : '';
  });
  for (const rows of daily.values()) {
    const campaignId: string = dorisString(rows[0], 'campaign_id')!;
    const dataDate: string = dorisString(rows[0], 'report_date')!;
    const accounts: string[] = [...(campaignAccounts.get(campaignId) || [])];
    const accountId: string | undefined =
      accounts.length === 1 ? accounts[0] : undefined;
    const qualityIssues: string[] = issues.filter(
      (issue: string) =>
        issue.includes('截断') &&
        ((issue.includes('投放明细') && !issue.startsWith('广告级')) ||
          /cohort/i.test(issue)),
    );
    if (!accountId) qualityIssues.push('广告账户归属尚未唯一确认');
    const matching: DorisRow[] = cohorts.filter(
      (row: DorisRow) =>
        dorisString(row, 'campaign_id') === campaignId &&
        dorisString(row, 'install_date') === dataDate,
    );
    const metrics: GrowthDeliveryMetricValues = aggregateCampaignMetrics(rows);
    if (matching.length === 1)
      metrics.d0_roas = dorisNumber(matching[0], 'd0_roas');
    else if (matching.length > 1)
      qualityIssues.push('同日 cohort 存在多条未确认粒度记录，D0 暂不合并');
    const adRows: DorisRow[] = ads
      .filter(
        (row: DorisRow) =>
          dorisString(row, 'campaign_id') === campaignId &&
          dorisString(row, 'report_date') === dataDate &&
          (!accountId || dorisString(row, 'advertiser_id') === accountId) &&
          !row.__diagnostic_dimension,
      )
      .map((row: DorisRow) => ({
        ...row,
        media_clicks:
          dorisNumber(row, 'media_clicks') ?? dorisNumber(row, 'clicks'),
        media_installs:
          dorisNumber(row, 'media_installs') ?? dorisNumber(row, 'installs'),
      }));
    const segments: GrowthDiagnosticBreakdown[] = [];
    for (const dimension of [
      'placement',
      'age',
      'gender',
      'audience',
    ] as const) {
      const segmentRows: DorisRow[] = ads
        .filter(
          (row: DorisRow) =>
            dorisString(row, 'campaign_id') === campaignId &&
            dorisString(row, 'report_date') === dataDate &&
            (!accountId || dorisString(row, 'advertiser_id') === accountId) &&
            row.__diagnostic_dimension === dimension,
        )
        .map((row: DorisRow) => ({
          ...row,
          media_clicks: dorisNumber(row, 'clicks'),
          media_installs: dorisNumber(row, 'installs'),
        }));
      segments.push(
        ...breakdown(
          segmentRows,
          dimension,
          '__diagnostic_value',
          '__diagnostic_label',
        ),
      );
    }
    snapshots.push({
      key: campaignHash([productId, accountId || 'unresolved', campaignId]),
      productId,
      campaignId,
      accountId,
      campaignName: dorisString(rows[0], 'campaign_name') || campaignId,
      countries: [
        ...new Set(
          rows
            .map((row: DorisRow) => dorisString(row, 'country_code') || '')
            .filter(Boolean),
        ),
      ].sort(),
      dataDate,
      fetchedAt,
      metrics,
      qualityIssues,
      breakdowns: [
        ...breakdown(rows, 'adset', 'adgroup_id', 'adgroup_name'),
        ...breakdown(rows, 'country', 'country_code', 'country_code'),
        ...breakdown(adRows, 'ad', 'ad_id', 'ad_name'),
        ...segments,
      ].sort((a, b) =>
        `${a.dimension}:${a.value}`.localeCompare(`${b.dimension}:${b.value}`),
      ),
    });
  }
  return snapshots;
}
