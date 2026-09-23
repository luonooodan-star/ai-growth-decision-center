import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  personalDorisStatus,
  savePersonalDoris,
  readPersonalDorisToken,
  runPersonalData,
  personalScopeKey,
} from '@server/common/utils/personal-doris';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { PaidGrowthService } from '@server/modules/growth-decision/paid-growth.service';
import { GrowthDataFetchService } from '@server/modules/growth-decision/growth-data-fetch.service';
import { GrowthDecisionService } from '@server/modules/growth-decision/growth-decision.service';
import { MetaOperationsService } from '@server/modules/growth-decision/meta-operations.service';

describe('personal Doris authorization and data isolation', () => {
  let directory: string, previous: NodeJS.ProcessEnv, db: LocalDatabaseService;
  beforeEach(() => {
    previous = { ...process.env };
    directory = mkdtempSync(join(tmpdir(), 'personal-doris-test-'));
    process.env.GROWTH_PERSONAL_STORAGE_ROOT = join(directory, 'credentials');
    process.env.GROWTH_DATABASE_PATH = join(directory, 'data.sqlite');
    process.env.DORIS_SUPERSET_MCP_TOKEN = 'forbidden-shared-fixture';
    db = new LocalDatabaseService();
  });
  afterEach(() => {
    db.onModuleDestroy();
    process.env = previous;
    rmSync(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
  });
  test('encrypted credentials are independently selected and never exposed by status', () => {
    savePersonalDoris('fjx', 'fixture-fjx-key');
    savePersonalDoris('growth', 'fixture-growth-key');
    expect(runPersonalData('fjx', readPersonalDorisToken)).toBe(
      'fixture-fjx-key',
    );
    expect(runPersonalData('growth', readPersonalDorisToken)).toBe(
      'fixture-growth-key',
    );
    expect(JSON.stringify(personalDorisStatus('fjx'))).not.toContain('fixture');
    for (const name of readdirSync(process.env.GROWTH_PERSONAL_STORAGE_ROOT!)) {
      const path = join(process.env.GROWTH_PERSONAL_STORAGE_ROOT!, name);
      expect(readFileSync(path).toString()).not.toContain('fixture-fjx-key');
      expect(statSync(path).mode & 0o077).toBe(0);
    }
  });
  test('unconfigured/revoked users never fall back to environment credentials', async () => {
    const fetcher = new GrowthDataFetchService(
      db,
      new GrowthDecisionService(db),
      new MetaOperationsService(db),
    );
    const network = jest.spyOn(globalThis, 'fetch');
    await expect(
      runPersonalData('fjx', () => fetcher.queryMetric({ dataset: 'example' })),
    ).rejects.toThrow('个人 Doris');
    expect(network).not.toHaveBeenCalled();
    savePersonalDoris('fjx', 'fixture-fjx-key');
    savePersonalDoris('fjx');
    expect(personalDorisStatus('fjx').configured).toBe(false);
    expect(() => runPersonalData('fjx', readPersonalDorisToken)).toThrow();
  });
  test('real query path sends only the initiating user credential through the shared query gate', async () => {
    savePersonalDoris('growth', 'fixture-growth-key');
    savePersonalDoris('fjx', 'fixture-fjx-key');
    const calls: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const authorization = (init?.headers as Record<string, string>)
        .Authorization;
      calls.push(authorization);
      await new Promise((resolve) => setImmediate(resolve));
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          result: {
            structuredContent: {
              rows: [{ spend: authorization.endsWith('fjx-key') ? 2 : 1 }],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const fetcher = new GrowthDataFetchService(
      db,
      new GrowthDecisionService(db),
      new MetaOperationsService(db),
    );
    const results = await Promise.all(
      ['growth', 'fjx', 'fjx'].map((username) =>
        runPersonalData(username, () =>
          fetcher.queryMetric({ dataset: 'example' }),
        ),
      ),
    );
    expect(results.map((result) => result.rows[0].spend)).toEqual([1, 2, 2]);
    expect(
      calls.filter((value) => value === 'Bearer fixture-growth-key'),
    ).toHaveLength(3);
    expect(
      calls.filter((value) => value === 'Bearer fixture-fjx-key'),
    ).toHaveLength(3); // Two identical fjx reads share one MCP exchange.
    expect(calls.join()).not.toContain('forbidden-shared');
  });
  test('legacy product standards and knowledge are shared while accounts and caches stay personal', () => {
    const legacy = db.listProducts()[0];
    db.saveProduct({
      ...legacy,
      skillVersion: 'shared-v2',
      thresholds: { goal: 100 },
      knowledge: [
        {
          id: 'shared',
          sourceCaseId: 'case',
          conclusion: 'shared knowledge',
          caution: 'review',
          approvedAt: new Date().toISOString(),
        },
      ],
    });
    db.saveBiCache('same', JSON.stringify('legacy-secret'));
    savePersonalDoris('growth', 'fixture-growth-key');
    savePersonalDoris('fjx', 'fixture-fjx-key');
    runPersonalData('growth', () => {
      expect(db.listProducts()[0].skillVersion).toBe('shared-v2');
      expect(db.getProduct(legacy.id)?.accountIds).toEqual([]);
      db.saveProduct({
        ...db.getProduct(legacy.id)!,
        accountIds: ['growth-only'],
        lastSyncAt: '2026-09-22',
        thresholds: { goal: 110 },
      });
      db.saveBiCache('same', JSON.stringify('growth-private'));
    });
    runPersonalData('fjx', () => {
      expect(db.getProduct(legacy.id)).toMatchObject({
        accountIds: [],
        thresholds: { goal: 110 },
        skillVersion: 'shared-v2',
      });
      expect(db.getProduct(legacy.id)?.knowledge?.[0].conclusion).toBe(
        'shared knowledge',
      );
      expect(db.getProduct(legacy.id)?.lastSyncAt).toBeUndefined();
      expect(db.getBiCache('same')).toBeUndefined();
      db.saveBiCache('same', JSON.stringify('fjx-private'));
    });
    expect(runPersonalData('growth', () => db.getBiCache('same'))).toBe(
      JSON.stringify('growth-private'),
    );
    expect(runPersonalData('fjx', () => db.getBiCache('same'))).toBe(
      JSON.stringify('fjx-private'),
    );
    expect(db.getBiCache('same')).toBe(JSON.stringify('legacy-secret'));
    expect(
      runPersonalData('growth', () => db.getProduct(legacy.id)?.accountIds),
    ).toEqual(['growth-only']);
    // Viewing the shared catalog does not require a personal data key.
    expect(
      runPersonalData('new-user', () => db.listProducts()[0].thresholds),
    ).toEqual({ goal: 110 });
  });
  test('rotating credentials changes namespace and invalidates old in-flight credential access', () => {
    savePersonalDoris('fjx', 'fixture-old-key');
    runPersonalData('fjx', () => {
      db.saveBiCache('same', JSON.stringify('old-permission-data'));
      const oldScope = personalScopeKey();
      savePersonalDoris('fjx', 'fixture-new-key');
      expect(() => readPersonalDorisToken()).toThrow('已更换');
      runPersonalData('fjx', () => {
        expect(personalScopeKey()).not.toBe(oldScope);
        expect(db.getBiCache('same')).toBeUndefined();
        expect(readPersonalDorisToken()).toBe('fixture-new-key');
      });
    });
  });
  test('identical concurrent BI requests never share another user pending result', async () => {
    savePersonalDoris('growth', 'fixture-growth-key');
    savePersonalDoris('fjx', 'fixture-fjx-key');
    const queryMetric = jest.fn(async () => {
      const scope = personalScopeKey();
      await new Promise((resolve) => setImmediate(resolve));
      return { rows: [{ name: scope, spend: 1 }] };
    });
    const service = new PaidGrowthService(
      db,
      { queryMetric } as unknown as GrowthDataFetchService,
      new GrowthDecisionService(db),
    );
    const args = {
      dataset: 'example',
      dimensions: ['name'],
      metrics: ['spend'],
    };
    const results = await Promise.all(
      ['growth', 'fjx'].map((username) =>
        runPersonalData(username, () => service.part(args, false)),
      ),
    );
    expect(queryMetric).toHaveBeenCalledTimes(4);
    expect(results[0].rows[0].name).toMatch(/^growth:/);
    expect(results[1].rows[0].name).toMatch(/^fjx:/);
  });
});
