import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CampaignDailySnapshot,
  GrowthProduct,
} from '@shared/api.interface';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { GrowthDecisionService } from '@server/modules/growth-decision/growth-decision.service';
import { GrowthMavisAnalysisService } from '@server/modules/growth-decision/growth-mavis-analysis.service';
import { CampaignDecisionService } from '@server/modules/growth-decision/campaign-decision.service';
import { GrowthDataFetchService } from '@server/modules/growth-decision/growth-data-fetch.service';
import { MetaOperationsService } from '@server/modules/growth-decision/meta-operations.service';
import {
  buildCampaignCard,
  previousDay,
} from '@server/modules/growth-decision/campaign-decision-engine';
import {
  aggregateCampaignMetrics,
  buildCampaignSnapshots,
} from '@server/modules/growth-decision/campaign-snapshots';

describe('campaign decisions and execution lifecycle', () => {
  const databasePath: string = join(
    tmpdir(),
    `campaign-test-${randomUUID()}.sqlite`,
  );
  let db: LocalDatabaseService;
  let service: CampaignDecisionService;
  let decisionService: GrowthDecisionService;
  let product: GrowthProduct;
  const now: Date = new Date();
  const day: string = previousDay(
    now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
  );
  const snapshot = (
    date: string,
    roas = 0.8,
    key = 'campaign-fixture',
  ): CampaignDailySnapshot => ({
    key,
    productId: product.id,
    campaignId: key,
    campaignName: 'Series fixture',
    accountId: 'account-fixture',
    countries: ['IN'],
    dataDate: date,
    fetchedAt: now.toISOString(),
    qualityIssues: [],
    breakdowns: [],
    metrics: {
      spend: 50,
      impressions: 100000,
      adjust_installs: 500,
      d0_roas: roas,
      cpi: 0.1,
    },
  });
  beforeAll(() => {
    process.env.GROWTH_DATABASE_PATH = databasePath;
    process.env.MAVIS_MCP_TOKEN = 'test-bridge-token-only';
    db = new LocalDatabaseService();
    product = db.listProducts()[0];
    product.metrics = product.metrics.map((m) => ({
      ...m,
      lowerBound: m.key === 'd0_roas' ? 0.7 : undefined,
      upperBound: undefined,
    }));
    product.targetMetric = 'd0_roas';
    db.saveProduct(product);
    decisionService = new GrowthDecisionService(db);
    service = new CampaignDecisionService(
      db,
      decisionService,
      new GrowthMavisAnalysisService(db),
    );
  });
  afterAll(() => {
    db.onModuleDestroy();
    delete process.env.GROWTH_DATABASE_PATH;
    delete process.env.MAVIS_MCP_TOKEN;
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(`${databasePath}${suffix}`, { force: true });
  });

  it('evaluates good campaigns, persistent losses, low samples, date gaps and missing D0 separately', () => {
    const history = [snapshot(day), snapshot(previousDay(day))];
    expect(buildCampaignCard(product, history, [], now).verdict).toBe(
      'increase',
    );
    expect(
      buildCampaignCard(
        product,
        history.map((s) => ({ ...s, metrics: { ...s.metrics, d0_roas: 0.3 } })),
        [],
        now,
      ).verdict,
    ).toBe('decrease');
    expect(buildCampaignCard(product, [snapshot(day)], [], now).verdict).toBe(
      'normal',
    );
    expect(
      buildCampaignCard(
        product,
        [snapshot(day), snapshot(previousDay(previousDay(day)))],
        [],
        now,
      ).verdict,
    ).toBe('normal');
    expect(
      buildCampaignCard(
        product,
        [
          {
            ...snapshot(day),
            metrics: { spend: 2, adjust_installs: 1, d0_roas: 0.9 },
          },
        ],
        [],
        now,
      ).verdict,
    ).toBe('observe');
    expect(
      buildCampaignCard(
        product,
        [
          {
            ...snapshot(day),
            metrics: { spend: 50, adjust_installs: 500, roas: 0.8 },
          },
        ],
        [],
        now,
      ).verdict,
    ).toBe('observe');
    expect(
      buildCampaignCard(
        product,
        history,
        [],
        new Date(now.getTime() + 4 * 3600000),
      ).verdict,
    ).toBe('observe');
  });

  it('aggregates denominators, keeps missing values missing and never assigns a campaign cohort to an adset', () => {
    expect(
      aggregateCampaignMetrics([
        { spend: 10, adjust_installs: 10 },
        { spend: 90, adjust_installs: 30 },
      ]).cpi,
    ).toBe(2.5);
    expect(aggregateCampaignMetrics([{ spend: 10 }, {}]).spend).toBeUndefined();
    const rows = [
      {
        report_date: day,
        campaign_id: 'a',
        country_code: 'IN',
        adgroup_id: 'g1',
        spend: 10,
      },
      {
        report_date: day,
        campaign_id: 'b',
        country_code: 'IN',
        adgroup_id: 'g2',
        spend: 20,
      },
    ];
    const snapshots = buildCampaignSnapshots(
      product.id,
      rows,
      [{ install_date: day, campaign_id: 'a', d0_roas: 0.8 }],
      [
        { campaign_id: 'a', advertiser_id: 'account-a' },
        { campaign_id: 'b', advertiser_id: 'account-b' },
      ],
      now.toISOString(),
      [],
    );
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].key).not.toBe(snapshots[1].key);
    expect(snapshots[0].metrics.d0_roas).toBe(0.8);
    expect(snapshots[0].breakdowns[0].metrics.d0_roas).toBeUndefined();
  });

  it('creates one Codex task for an unchanged campaign revision without polluting the anomaly queue', async () => {
    db.saveCampaignSnapshot(snapshot(day));
    db.saveCampaignSnapshot(snapshot(previousDay(day)));
    const card = service.board(product.id).items[0];
    const first = await service.analyze(product.id, card.key, card.revision);
    const second = await service.analyze(product.id, card.key, card.revision);
    expect(first.id).toBe(second.id);
    expect(db.listMavisJobs(first.id)).toHaveLength(1);
    expect(
      (await decisionService.getDashboard()).judgments.some(
        (j) => j.id === first.id,
      ),
    ).toBe(false);
    expect(db.listMavisJobs(first.id)[0].status).toBe('queued');
  });

  it('acceptance does not start an experiment; actual execution starts exactly one baseline and is idempotent', async () => {
    const card = service.board(product.id).items[0];
    const request = {
      key: card.key,
      revision: card.revision,
      decision: 'accept' as const,
      reason: 'Validated campaign budget',
      budgetLevel: 'campaign' as const,
      budgetTargetId: card.snapshot.campaignId,
      beforeBudget: 100,
    };
    const accepted = await service.decide(product.id, request);
    expect(accepted.status).toBe('awaiting_execution');
    expect(accepted.campaignExecution?.afterBudget).toBe(110);
    expect(db.listMonitoringSnapshots(accepted.id)).toHaveLength(0);
    await expect(
      decisionService.updateResult(
        accepted.id,
        {
          classification: 'expected',
          actualChangePct: 10,
          actualResult: 'premature',
        },
        'growth',
      ),
    ).rejects.toThrow('实际执行');
    expect((await service.decide(product.id, request)).id).toBe(accepted.id);
    await expect(
      decisionService.updateDecision(
        accepted.id,
        { action: 'accepted', reason: 'bypass' },
        'growth',
      ),
    ).rejects.toThrow();
    const executed = await service.execute(accepted.id, {
      confirmation: 'EXECUTED',
      note: 'Changed 100 to 110',
    });
    expect(executed.status).toBe('accepted');
    expect(executed.executedAt).toBeTruthy();
    expect(db.listMonitoringSnapshots(accepted.id)).toHaveLength(1);
    await service.execute(accepted.id, {
      confirmation: 'EXECUTED',
      note: 'retry',
    });
    expect(db.listMonitoringSnapshots(accepted.id)).toHaveLength(1);
    expect(service.board(product.id).items[0].blockers.join()).toContain(
      '已有待执行',
    );
  });

  it('rejects stale revisions and foreign budget targets; observing is not a budget experiment', async () => {
    db.saveCampaignSnapshot(snapshot(day, 0.8, 'other'));
    db.saveCampaignSnapshot(snapshot(previousDay(day), 0.8, 'other'));
    const card = service
      .board(product.id)
      .items.find((c) => c.key === 'other')!;
    await expect(
      service.decide(product.id, {
        key: card.key,
        revision: 'stale',
        decision: 'reject',
        reason: 'x',
      }),
    ).rejects.toThrow('刷新');
    await expect(
      service.decide(product.id, {
        key: card.key,
        revision: card.revision,
        decision: 'accept',
        reason: 'x',
        budgetLevel: 'campaign',
        budgetTargetId: 'foreign',
        beforeBudget: 100,
      }),
    ).rejects.toThrow('不属于');
    const rejected = await service.decide(product.id, {
      key: card.key,
      revision: card.revision,
      decision: 'reject',
      reason: 'Strategy mismatch',
    });
    expect(rejected.status).toBe('rejected');
    expect(
      (await decisionService.getDecisionHistory(rejected.id)).items.some(
        (a) => a.action === 'campaign_reject',
      ),
    ).toBe(true);
    const observed = await service.decide(product.id, {
      key: card.key,
      revision: card.revision,
      decision: 'observe',
      reason: 'Wait',
    });
    expect(observed.recommendedAction.actionType).toBe('observe');
    expect(observed.campaignExecution?.beforeBudget).toBeUndefined();
  });

  it('allows a pending order to be withdrawn without creating an experiment', async () => {
    db.saveCampaignSnapshot(snapshot(day, 0.8, 'withdraw'));
    db.saveCampaignSnapshot(snapshot(previousDay(day), 0.8, 'withdraw'));
    const card = service
      .board(product.id)
      .items.find((c) => c.key === 'withdraw')!;
    const order = await service.decide(product.id, {
      key: card.key,
      revision: card.revision,
      decision: 'accept',
      reason: 'test',
      budgetLevel: 'campaign',
      budgetTargetId: card.snapshot.campaignId,
      beforeBudget: 100,
    });
    const withdrawn = await decisionService.updateDecision(
      order.id,
      { action: 'rejected', reason: 'withdraw' },
      'growth',
    );
    expect(withdrawn.campaignExecution?.state).toBe('rejected');
    expect(db.listMonitoringSnapshots(order.id)).toHaveLength(0);
    await expect(
      service.execute(order.id, { confirmation: 'EXECUTED', note: 'invalid' }),
    ).rejects.toThrow('待执行');
  });

  it('keeps available placement data and only treats truncated core data as a completeness blocker', () => {
    const delivery = [
      {
        report_date: day,
        campaign_id: 'segments',
        advertiser_id: 'account',
        country_code: 'IN',
        spend: 50,
        adjust_installs: 500,
      },
    ];
    const segments = [
      {
        report_date: day,
        campaign_id: 'segments',
        advertiser_id: 'account',
        __diagnostic_dimension: 'placement',
        __diagnostic_value: 'feed',
        __diagnostic_label: 'Feed',
        spend: 50,
        impressions: 10000,
        clicks: 100,
      },
    ];
    const result = buildCampaignSnapshots(
      product.id,
      delivery,
      [],
      segments,
      now.toISOString(),
      ['cohort 明细的可选指标未接受，改用基础数据', 'Doris 未返回 age 拆分'],
    );
    expect(result[0].qualityIssues).toEqual([]);
    expect(
      result[0].breakdowns.find((b) => b.dimension === 'placement')?.metrics
        .ctr,
    ).toBe(0.01);
    expect(
      buildCampaignSnapshots(
        product.id,
        delivery,
        [],
        segments,
        now.toISOString(),
        ['cohort 明细达到查询上限 5000 行，可能截断'],
      )[0].qualityIssues,
    ).toHaveLength(1);
  });

  it('never declares recovery based on a data day before actual execution', () => {
    const executed = db
      .listDecisionRecords()
      .find(
        (r) =>
          'campaignExecution' in r && r.campaignExecution?.state === 'executed',
      )!;
    new GrowthDataFetchService(db, decisionService, new MetaOperationsService(db))[
      'updateMonitoringSnapshots'
    ](product, [], []);
    const record = db.getDecisionRecord(executed.id)!;
    expect(
      'recoveryReadyAt' in record ? record.recoveryReadyAt : undefined,
    ).toBeUndefined();
    expect(
      db.listMonitoringSnapshots(executed.id, 1)[0].isWithinNormalRange,
    ).toBe(false);
  });
});
