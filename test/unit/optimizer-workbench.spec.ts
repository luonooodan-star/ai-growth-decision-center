import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CampaignDailySnapshot,
  CampaignDecisionRule,
  GrowthProduct,
} from '@shared/api.interface';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { CampaignDecisionService } from '@server/modules/growth-decision/campaign-decision.service';
import { CampaignBoardManagementService } from '@server/modules/growth-decision/campaign-board-management.service';
import { GrowthDecisionService } from '@server/modules/growth-decision/growth-decision.service';
import { GrowthMavisAnalysisService } from '@server/modules/growth-decision/growth-mavis-analysis.service';
import { OptimizerWorkflowService } from '@server/modules/growth-decision/optimizer-workflow.service';
import {
  buildCampaignCard,
  previousDay,
} from '@server/modules/growth-decision/campaign-decision-engine';
import {
  workQueue,
  analysisEvidence,
  canReuseAnalysis,
} from '@server/modules/growth-decision/campaign-workbench';
import {
  OptimizerWeeklyService,
  reviewWeek,
} from '@server/modules/growth-decision/optimizer-weekly.service';

describe('optimizer workbench', () => {
  const file = join(tmpdir(), `optimizer-${randomUUID()}.sqlite`);
  let db: LocalDatabaseService,
    product: GrowthProduct,
    service: CampaignDecisionService,
    management: CampaignBoardManagementService,
    workflow: OptimizerWorkflowService;
  const now = new Date(),
    day = previousDay(
      now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
    );
  const snapshot = (date = day): CampaignDailySnapshot => ({
    key: 'test',
    productId: product.id,
    campaignId: 'campaign',
    campaignName: 'Fixture',
    accountId: 'account',
    countries: ['IN'],
    dataDate: date,
    fetchedAt: now.toISOString(),
    qualityIssues: [],
    breakdowns: [],
    metrics: { spend: 100, adjust_installs: 500, d0_roas: 0.9 },
  });
  const rule: CampaignDecisionRule = {
    id: 'observe',
    name: 'Observe good return',
    enabled: true,
    verdict: 'observe',
    priority: 80,
    urgent: false,
    consecutiveDays: 1,
    conditions: [
      { metric: 'd0_roas', basis: 'value', operator: 'gte', value: 0.7 },
    ],
    actionText: 'Review first',
  };
  beforeAll(() => {
    process.env.GROWTH_DATABASE_PATH = file;
    db = new LocalDatabaseService();
    product = db.listProducts()[0];
    product.targetMetric = 'd0_roas';
    product.metrics = product.metrics.map((m) => ({
      ...m,
      lowerBound: m.key === 'd0_roas' ? 0.7 : undefined,
      upperBound: undefined,
    }));
    db.saveProduct(product);
    db.saveCampaignSnapshot(snapshot());
    db.saveCampaignSnapshot(snapshot(previousDay(day)));
    service = new CampaignDecisionService(
      db,
      new GrowthDecisionService(db),
      new GrowthMavisAnalysisService(db),
    );
    management = new CampaignBoardManagementService(db, service);
    workflow = new OptimizerWorkflowService(db, service);
  });
  afterAll(() => {
    db.onModuleDestroy();
    delete process.env.GROWTH_DATABASE_PATH;
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(file + suffix, { force: true });
  });

  it('previews without writing, identifies overlap, protects stale preview and restores versions via draft', () => {
    const config = management.rules(product.id),
      prior = JSON.stringify(db.getProduct(product.id));
    const request = {
      ...config,
      rules: [rule, { ...rule, id: 'lower', priority: 10 }],
    };
    const preview = management.preview(product.id, request);
    expect(preview.changed).toBeGreaterThan(0);
    expect(preview.items[0].conflicts).toHaveLength(2);
    expect(JSON.stringify(db.getProduct(product.id))).toBe(prior);
    expect(db.listActivities(product.id)).toHaveLength(0);
    db.saveCampaignSnapshot({
      ...snapshot(),
      metrics: { ...snapshot().metrics, spend: 110 },
    });
    expect(() =>
      management.saveRules(product.id, {
        ...request,
        previewToken: preview.token,
      }),
    ).toThrow('重新试跑');
    const fresh = management.preview(product.id, request);
    const saved = management.saveRules(product.id, {
      ...request,
      previewToken: fresh.token,
    });
    expect(saved.board.items[0].verdict).toBe('observe');
    const version = management.versions(product.id)[0];
    expect(version.rules).toEqual([]);
    management.saveRules(product.id, { ...saved, rules: version.rules });
    expect(service.board(product.id).items[0].verdict).toBe('increase');
  });
  it('does not call stale positive-spend campaigns inactive; archives explicit zero history', () => {
    const stale = buildCampaignCard(
      product,
      [
        {
          ...snapshot(),
          fetchedAt: new Date(now.getTime() - 86400000).toISOString(),
        },
      ],
      [],
      now,
    );
    expect(workQueue(stale, now.getTime())).toBe('repair');
    expect(stale.noRecentDelivery).toBe(false);
    const card = buildCampaignCard(
      product,
      [snapshot(), snapshot(previousDay(day))],
      [],
      now,
    );
    expect(workQueue(card)).toBe('opportunity');
    expect(
      workQueue({
        ...card,
        noRecentDelivery: true,
        noDeliveryHideAfter: new Date(now.getTime() - 1).toISOString(),
      }),
    ).toBe('archive');
  });
  it('ignores retrieval timestamps for reuse but detects metric, ad and action changes', () => {
    const card = buildCampaignCard(product, [snapshot()], [], now);
    expect(analysisEvidence(card)).toBe(
      analysisEvidence({
        ...card,
        trend: card.trend.map((s) => ({ ...s, fetchedAt: 'changed' })),
      }),
    );
    expect(analysisEvidence(card)).not.toBe(
      analysisEvidence({
        ...card,
        trend: card.trend.map((s) => ({
          ...s,
          breakdowns: [
            { dimension: 'ad', value: 'new', metrics: { spend: 80 } },
          ],
        })),
      }),
    );
  });
  it('creates a timed observation once, extends with audit and finishes without inventing results', async () => {
    const card = service.board(product.id).items[0];
    const req = {
      key: card.key,
      revision: card.revision,
      decision: 'observe' as const,
      reason: 'Wait for mature data',
    };
    const first = await service.decide(product.id, req);
    expect(first.campaignExecution!.reviewDueAt).toBeDefined();
    expect(first.campaignExecution!.observationPlan?.minSpend).toBe(30);
    expect((await service.decide(product.id, req)).id).toBe(first.id);
    db.saveDecisionRecord({
      ...first,
      campaignExecution: {
        ...first.campaignExecution!,
        reviewDueAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    expect(service.board(product.id).items[0].workQueue).toBe('due');
    expect(() =>
      workflow.observe(first.id, {
        action: 'finish',
        reason: 'ok',
        confirmation: '',
      }),
    ).toThrow();
    workflow.observe(first.id, {
      action: 'extend',
      reason: 'Not enough sample',
      confirmation: 'REVIEW_OBSERVATION',
    });
    expect(service.board(product.id).items[0].workQueue).toBe('observation');
    const ended = workflow.observe(first.id, {
      action: 'finish',
      reason: 'Reviewed',
      confirmation: 'REVIEW_OBSERVATION',
    });
    expect(ended.status).toBe('completed');
    expect(ended.resultClassification).toBeUndefined();
    expect(ended.executedAt).toBeUndefined();
    expect(() =>
      workflow.publishKnowledge(first.id, {
        confirmation: 'APPROVE_KNOWLEDGE',
        conclusion: 'not an experiment',
      }),
    ).toThrow();
    expect(workflow.review(product.id).medianDecisionMinutes).toBeNull();
    expect(workflow.review(product.id).accepted).toBe(0);
  });

  it('reuses small same-day changes but not significant changes, new days or due reviews', () => {
    const card = buildCampaignCard(product, [snapshot()], [], now);
    const changed = (spend: number) => ({
      ...card,
      trend: card.trend.map((s) => ({
        ...s,
        metrics: { ...s.metrics, spend },
      })),
    });
    expect(canReuseAnalysis(card, changed(105))).toBe(true);
    expect(canReuseAnalysis(card, changed(120))).toBe(false);
    expect(canReuseAnalysis(card, { ...card, workQueue: 'due' })).toBe(false);
    expect(
      canReuseAnalysis(card, {
        ...card,
        snapshot: { ...card.snapshot, dataDate: previousDay(day) },
      }),
    ).toBe(false);
  });

  it('records first detail view once and uses real measured elapsed time only', async () => {
    const card = service.board(product.id).items[0];
    management.viewed(product.id, card);
    management.viewed(product.id, card);
    expect(workflow.review(product.id).opened).toBe(1);
    await service.decide(product.id, {
      key: card.key,
      revision: card.revision,
      decision: 'reject',
      reason: 'reviewed',
    });
    expect(workflow.review(product.id).medianDecisionMinutes).not.toBeNull();
  });

  it('requires post-execution observations for knowledge, preserves negative conclusions and deduplicates', () => {
    const source = db
      .listDecisionRecords()
      .find(
        (r) => 'campaignExecution' in r && r.status === 'completed',
      ) as import('@shared/api.interface').GrowthDecisionCase;
    const id = randomUUID(),
      executedAt = `${previousDay(previousDay(day))}T00:00:00+08:00`;
    const record = {
      ...source,
      id,
      executedAt,
      resultClassification: 'negative',
      actualResult: 'No improvement',
      campaignExecution: {
        ...source.campaignExecution!,
        state: 'executed' as const,
        executedAt,
      },
    };
    db.saveDecisionRecord(record);
    const body = {
      confirmation: 'APPROVE_KNOWLEDGE',
      conclusion: 'This action did not help; confounders remain.',
    };
    expect(() => workflow.publishKnowledge(id, body)).toThrow('缺少执行后');
    db.saveMonitoringSnapshot({
      id: randomUUID(),
      recordId: id,
      productId: product.id,
      subjectType: 'experiment',
      observedAt: now.toISOString(),
      dataDate: day,
      metrics: { d0_roas: 0.6 },
      previousMetrics: {},
      changesPct: {},
      isWithinNormalRange: false,
      source: 'test',
    });
    const first = workflow.publishKnowledge(id, body);
    expect(workflow.publishKnowledge(id, body).id).toBe(first.id);
    expect(db.getProduct(product.id)?.knowledge).toHaveLength(1);
  });

  it('keeps weekly reports opt-in, idempotent, and anchored to Shanghai Monday 10am', () => {
    expect(reviewWeek(new Date('2026-09-21T01:59:00Z'))).toBe('2026-09-14');
    expect(reviewWeek(new Date('2026-09-21T02:00:00Z'))).toBe('2026-09-21');
    const weekly = new OptimizerWeeklyService(db, workflow);
    weekly.tick();
    expect(weekly.state(product.id).reports).toHaveLength(0);
    weekly.configure(product.id, true);
    weekly.tick();
    weekly.tick();
    expect(weekly.state(product.id).reports).toHaveLength(1);
    expect(weekly.generate(product.id).reports).toHaveLength(1);
    expect(() => weekly.configure('missing-product', true)).toThrow();
  });
});
