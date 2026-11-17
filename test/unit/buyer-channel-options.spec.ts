import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalDatabaseService } from '../../server/database/local-database.service';
import {
  personalDataIdentity,
  personalScopeKey,
} from '../../server/common/utils/personal-doris';
import { roasReportChannels } from '../../shared/roas-report-filters';
import { PaidGrowthService } from '../../server/modules/growth-decision/paid-growth.service';
import { GrowthDecisionService } from '../../server/modules/growth-decision/growth-decision.service';
const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const sourceKey = () =>
  personalScopeKey() +
  ':' +
  JSON.stringify({
    dataset: 'bi_ads.ads_paid_acquisition_daily',
    start_date: date,
    end_date: date,
    dimensions: ['app_id', 'media_source', 'buyer_alias'],
    metrics: ['spend'],
  });
const row = (buyer_alias: string, media_source: string, spend = 1) => ({
  app_id: 12,
  buyer_alias,
  media_source,
  spend,
  report_date: date,
});
const payload = (rows: unknown[]) =>
  JSON.stringify({ state: 'fresh', rows, updatedAt: new Date().toISOString() });
describe('paid-data optimizer channel memberships', () => {
  let directory: string,
    path: string,
    db: LocalDatabaseService,
    old: string | undefined;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'buyer-channels-'));
    path = join(directory, 'data.sqlite');
    old = process.env.GROWTH_DATABASE_PATH;
    process.env.GROWTH_DATABASE_PATH = path;
    db = new LocalDatabaseService();
  });
  afterEach(() => {
    db.onModuleDestroy();
    if (old === undefined) delete process.env.GROWTH_DATABASE_PATH;
    else process.env.GROWTH_DATABASE_PATH = old;
    rmSync(directory, { recursive: true, force: true });
  });
  it('populates options before loading ROAS and adds Google only after lzx has real readings', () => {
    db.saveBiCache(
      sourceKey(),
      payload([
        row('lzx', 'facebook'),
        row('lzx', 'tiktok'),
        row('lzx', 'applovin'),
        row('jsa', 'google ads'),
        row('lzx', 'google ads', 0),
      ]),
    );
    expect(
      roasReportChannels([], [], 'android', 'lzx', db.getBuyerChannelOptions()),
    ).toEqual(['applovin', 'facebook', 'tiktok']);
    db.saveBiCache(sourceKey(), payload([row('lzx', 'google ads', 12)]));
    expect(
      roasReportChannels([], [], 'android', 'lzx', db.getBuyerChannelOptions()),
    ).toEqual(['applovin', 'facebook', 'google ads', 'tiktok']);
    expect(
      roasReportChannels([], [], 'android', 'jsa', db.getBuyerChannelOptions()),
    ).toEqual(['google ads']);
  });
  it('migrates existing local paid caches without a Doris request and preserves the relationship after restart', () => {
    const connection = new DatabaseSync(path);
    connection
      .prepare('INSERT INTO growth_bi_cache(cache_key,payload) VALUES (?,?)')
      .run(
        sourceKey(),
        payload([row('lzx', 'tiktok'), row('jsa', 'google ads')]),
      );
    connection.close();
    expect(
      db
        .getBuyerChannelOptions()
        .filter((r) => r.buyer === 'lzx')
        .map((r) => r.channel),
    ).toEqual(['tiktok']);
    db.onModuleDestroy();
    db = new LocalDatabaseService();
    expect(
      db
        .getBuyerChannelOptions()
        .filter((r) => r.buyer === 'lzx')
        .map((r) => r.channel),
    ).toEqual(['tiktok']);
  });
  it('isolates scopes and credential revisions and does not infer ownership from channel-only rows', () => {
    const asUser = <T>(username: string, revision: string, fn: () => T) =>
      personalDataIdentity.run({ username, revision }, fn);
    asUser('a', 'r1', () =>
      db.saveBiCache(
        sourceKey(),
        payload([
          row('lzx', 'tiktok'),
          { app_id: 12, media_source: 'google ads', spend: 100 },
        ]),
      ),
    );
    expect(
      asUser('a', 'r1', () => db.getBuyerChannelOptions()).map(
        (r) => r.channel,
      ),
    ).toEqual(['tiktok']);
    expect(asUser('a', 'r2', () => db.getBuyerChannelOptions())).toEqual([]);
    expect(asUser('b', 'r1', () => db.getBuyerChannelOptions())).toEqual([]);
  });
  it('ignores failed and expired data and classifies actual W2A readings without inventing Web ownership', () => {
    db.saveBiCache(
      sourceKey(),
      payload([
        { ...row('lzx', 'facebook'), campaign_name: 'app_w2a_campaign' },
        { ...row('jsa', 'google ads'), report_date: '2000-01-01' },
      ]),
    );
    db.saveBiCache(
      sourceKey() + 'failure',
      JSON.stringify({
        state: 'stale',
        rows: [row('lzx', 'google ads')],
        updatedAt: new Date().toISOString(),
      }),
    );
    expect(
      db.getBuyerChannelOptions().map((r) => [r.buyer, r.channel]),
    ).toEqual([['lzx', 'facebook_web']]);
  });
  it('includes optimizer ownership in operator paid-data queries to update associations automatically', async () => {
    const fetcher = {
      queryMetric: jest.fn(async (args: Record<string, unknown>) => ({
        rows: [],
      })),
    };
    const service = new PaidGrowthService(
      db,
      fetcher as never,
      new GrowthDecisionService(db),
    );
    await service.day({ date, level: 'products' });
    const daily = fetcher.queryMetric.mock.calls.filter(
      ([args]) => args.dataset === 'bi_ads.ads_paid_acquisition_daily',
    );
    expect(
      daily.some(([args]) =>
        (args.dimensions as string[]).includes('buyer_alias'),
      ),
    ).toBe(true);
  });
});
