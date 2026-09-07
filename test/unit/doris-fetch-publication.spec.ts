import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { GrowthDecisionService } from '@server/modules/growth-decision/growth-decision.service';
import { GrowthDataFetchService } from '@server/modules/growth-decision/growth-data-fetch.service';
import { campaignHash } from '@server/modules/growth-decision/campaign-snapshots';
import type {
  DorisQueryResult,
  DorisRow,
} from '@server/modules/growth-decision/doris-result-normalizer';

interface FetchInternals {
  queryMetric: (args: Record<string, unknown>) => Promise<DorisQueryResult>;
  queryOptionalFacebookBreakdown: (...args: unknown[]) => Promise<DorisRow[]>;
}
describe('fetch publication and restart recovery', () => {
  let db: LocalDatabaseService;
  let service: GrowthDataFetchService;
  let directory: string;
  let oldPath: string | undefined;
  const day = new Date().toISOString().slice(0, 10);
  beforeEach(() => {
    oldPath = process.env.GROWTH_DATABASE_PATH;
    directory = mkdtempSync(join(tmpdir(), 'fetch-publication-'));
    process.env.GROWTH_DATABASE_PATH = join(directory, 'test.sqlite');
    db = new LocalDatabaseService();
    service = new GrowthDataFetchService(db, new GrowthDecisionService(db));
  });
  afterEach(() => {
    service.onModuleDestroy();
    db.onModuleDestroy();
    if (oldPath === undefined) delete process.env.GROWTH_DATABASE_PATH;
    else process.env.GROWTH_DATABASE_PATH = oldPath;
    rmSync(directory, { recursive: true });
    jest.restoreAllMocks();
  });
  function mockSource(broken: 'cohort' | 'ad' | undefined): void {
    const internals = service as unknown as FetchInternals;
    jest
      .spyOn(internals, 'queryOptionalFacebookBreakdown')
      .mockResolvedValue([]);
    jest.spyOn(internals, 'queryMetric').mockImplementation(async (args) => {
      const dataset = String(args.dataset);
      const dimensions = args.dimensions as string[];
      if (
        broken === 'cohort' &&
        dataset.includes('cohort') &&
        dimensions.includes('campaign_id')
      )
        throw new Error('fixture cohort incomplete');
      if (
        broken === 'ad' &&
        dataset.includes('facebook_ad_daily') &&
        dimensions.includes('ad_id')
      )
        throw new Error('fixture ad incomplete');
      const all: DorisRow = {
        report_date: day,
        install_date: day,
        app_id: 1,
        country_code: 'IN',
        campaign_id: 'campaign-1',
        campaign_name: 'Campaign',
        advertiser_id: 'account-1',
        adgroup_id: 'group-1',
        adgroup_name: 'Group',
        ad_id: 'ad-1',
        ad_name: 'Ad',
        spend: 50,
        impressions: 10000,
        cohort_spend: 50,
        cumulative_metric_value: 40,
        d0_roas: 0.8,
        adjust_installs: 100,
        adjust_revenue: 40,
        media_installs: 100,
        media_clicks: 200,
        cpi: 0.5,
        ctr: 0.02,
        roas: 0.8,
      };
      const filters = JSON.parse(String(args.filters_json || '{}'));
      if (filters.country_code?.[0] === 'PK') return { rows: [], row_count: 0 };
      return {
        rows: [
          {
            ...Object.fromEntries(dimensions.map((d) => [d, all[d]])),
            ...Object.fromEntries(
              (args.metrics as string[]).map((m) => [m, all[m]]),
            ),
          },
        ],
        row_count: 1,
      };
    });
  }
  it.each(['cohort', 'ad'] as const)(
    'does not overwrite an older complete snapshot when %s fails',
    async (broken) => {
      const product = db.listProducts()[0];
      const key = campaignHash([product.id, 'account-1', 'campaign-1']);
      db.saveCampaignSnapshot({
        key,
        productId: product.id,
        accountId: 'account-1',
        campaignId: 'campaign-1',
        campaignName: 'Campaign',
        countries: ['IN'],
        dataDate: day,
        fetchedAt: '2026-01-01T00:00:00Z',
        metrics: { spend: 42, d0_roas: 0.9 },
        breakdowns: [],
        qualityIssues: [],
      });
      mockSource(broken);
      const runs = await service.trigger('manual', product.id, 1);
      expect(runs[0].status).toBe('partial');
      expect(runs[0].gaps?.length).toBeGreaterThan(0);
      const retained = db
        .listCampaignSnapshots(product.id)
        .find((s) => s.key === key)!;
      expect(retained.metrics.spend).toBe(42);
      expect(retained.fetchedAt).toBe('2026-01-01T00:00:00Z');
      expect(retained.qualityIssues.join('')).toContain('补齐未完成');
    },
  );
  it('publishes validated data and clears a previous repair blocker', async () => {
    const product = db.listProducts()[0];
    mockSource(undefined);
    const runs = await service.trigger('manual', product.id, 1);
    expect(runs[0].status).toBe('success');
    expect(runs[0].gaps).toEqual([]);
    const snapshot = db.listCampaignSnapshots(product.id)[0];
    expect(snapshot.metrics.spend).toBe(50);
    expect(snapshot.metrics.d0_roas).toBe(0.8);
    expect(snapshot.qualityIssues).toEqual([]);
  });
  it('persists checkpoints across database reopen and marks interrupted runs resumable', () => {
    const product = db.listProducts()[0];
    db.saveFetchCheckpoint({
      key: 'saved-part',
      productId: product.id,
      updatedAt: new Date().toISOString(),
      rows: [{ a: 1 }],
    });
    db.saveFetchRun({
      id: randomUUID(),
      productId: product.id,
      status: 'running',
      trigger: 'manual',
      startedAt: new Date().toISOString(),
      rowsFetched: 0,
      anomalyCount: 0,
      source: 'fixture',
      message: 'running',
    });
    db.onModuleDestroy();
    db = new LocalDatabaseService();
    service = new GrowthDataFetchService(db, new GrowthDecisionService(db));
    service.onModuleInit();
    expect(db.getFetchCheckpoint('saved-part')?.rows).toEqual([{ a: 1 }]);
    expect(db.listFetchRuns(product.id)[0].status).toBe('partial');
    expect(db.listFetchRuns(product.id)[0].message).toContain('续抓');
  });
});
