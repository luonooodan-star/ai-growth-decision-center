import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  MetaOperationInput,
  CampaignDailySnapshot,
} from '@shared/api.interface';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { MetaOperationsService } from '@server/modules/growth-decision/meta-operations.service';
import {
  normalizeMetaOperation,
  reviewMetaOperation,
} from '@server/modules/growth-decision/meta-operation-engine';

const input: MetaOperationInput = {
  accountId: '1108190171558007',
  objectId: '120249140890910527',
  campaignId: '120249140890910527',
  campaignName: 'test campaign',
  objectName: 'test campaign',
  objectLevel: 'campaign',
  actorId: '123',
  actorName: 'test optimizer',
  systemActor: false,
  occurredAt: '2026-01-05T09:00:00+08:00',
  accountTimezone: 'Asia/Shanghai',
  eventType: '广告系列预算已更新',
  field: 'budget',
  before: 500,
  after: 800,
  raw: '{"fixture":true}',
};
describe('Meta read-only operation lifecycle', () => {
  let db: LocalDatabaseService;
  let service: MetaOperationsService;
  let directory: string;
  let previous: string | undefined;
  let productId: string;
  const snapshot = (day: string, spend = 40): CampaignDailySnapshot => ({
    key: 'fixture',
    productId,
    campaignId: input.campaignId!,
    campaignName: 'test campaign',
    accountId: input.accountId,
    dataDate: day,
    fetchedAt: '2026-01-10T00:00:00Z',
    countries: ['EG'],
    qualityIssues: [],
    breakdowns: [],
    metrics: { spend, adjust_installs: 200, d0_roas: 0.6 },
  });
  beforeEach(() => {
    previous = process.env.GROWTH_DATABASE_PATH;
    directory = mkdtempSync(join(tmpdir(), 'meta-operations-test-'));
    process.env.GROWTH_DATABASE_PATH = join(directory, 'test.sqlite');
    db = new LocalDatabaseService();
    service = new MetaOperationsService(db);
    productId = db.listProducts()[0].id;
  });
  afterEach(() => {
    db.onModuleDestroy();
    rmSync(directory, { recursive: true });
    if (previous === undefined) delete process.env.GROWTH_DATABASE_PATH;
    else process.env.GROWTH_DATABASE_PATH = previous;
  });
  it('deduplicates overlapping imports and creates only one actual-operation experiment', () => {
    db.saveCampaignSnapshot(snapshot('2026-01-04'));
    expect(service.import({ operations: [input] }).inserted).toBe(1);
    expect(
      service.import({ operations: [{ ...input, campaignName: 'renamed' }] })
        .duplicates,
    ).toBe(1);
    expect(service.overview().items[0].operation.category).toBe('increase');
    expect(
      db.listDecisionRecords().filter((r) => 'metaOperationId' in r),
    ).toHaveLength(1);
  });
  it('enriches current targets without inventing historical operation fields', () => {
    service.import({ operations: [input], entities: [
      { accountId: input.accountId, id: input.campaignId!, campaignId: input.campaignId!, level: 'campaign', name: 'campaign', objective: 'OUTCOME_SALES', fetchedAt: '2026-09-20T01:00:00Z' },
      { accountId: input.accountId, id: '123456', campaignId: input.campaignId!, level: 'adset', name: 'adset', optimizationGoal: 'OFFSITE_CONVERSIONS', conversionEvent: 'PURCHASE', conversionEventStatus: 'returned', fetchedAt: '2026-09-20T01:00:00Z' },
    ] });
    const operation = service.linkedOperations()[0];
    expect(operation.objective).toBeUndefined();
    expect(operation.currentTargets?.objectives).toEqual(['OUTCOME_SALES']);
    expect(operation.currentTargets?.conversionEvents).toEqual(['purchase']);
    const adset = db.listMetaEntities().find(e => e.level === 'adset')!;
    db.saveMetaEntity({ ...adset, optimizationGoal: undefined, conversionEvent: undefined, fetchedAt: '2026-09-20T02:00:00Z' });
    expect(db.listMetaEntities().find(e => e.level === 'adset')?.conversionEvent).toBe('PURCHASE');
    db.saveMetaEntity({ ...adset, conversionEvent: undefined, conversionEventStatus: 'not_configured', fetchedAt: '2026-09-20T03:00:00Z' });
    expect(db.listMetaEntities().find(e => e.level === 'adset')?.conversionEvent).toBeUndefined();
    db.saveMetaEntity(adset);
    expect(db.listMetaEntities().find(e => e.level === 'adset')?.conversionEvent).toBeUndefined();
  });
  it('plans only recent project campaigns and paginates metadata synchronization', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 23; i++) db.saveCampaignSnapshot({ ...snapshot(today), key: `target-${i}`, campaignId: String(10000 + i) });
    const first = service.syncPlan();
    expect(first.total).toBe(23);
    expect(first.targets).toHaveLength(20);
    expect(first.nextOffset).toBe(20);
    expect(first.targets[0].missingFields).toEqual(['objective', 'optimization_goal', 'promoted_object']);
    expect(service.syncPlan(20).targets).toHaveLength(3);
    expect(service.syncPlan(20).nextOffset).toBeNull();
    expect(first.targets.every(t => t.accountId === input.accountId)).toBe(true);
  });
  it('does not guess account identity, but relinks after Doris arrives', () => {
    service.import({ operations: [input] });
    expect(service.overview().items[0].operation.linked).toBe(false);
    expect(
      db.listDecisionRecords().filter((r) => 'metaOperationId' in r),
    ).toHaveLength(0);
    db.saveCampaignSnapshot({ ...snapshot('2026-01-04'), accountId: '999' });
    service.reconcile();
    expect(service.overview().items[0].operation.linked).toBe(false);
    db.saveCampaignSnapshot(snapshot('2026-01-04'));
    service.reconcile();
    expect(service.overview().items[0].operation.linked).toBe(true);
  });
  it('keeps system and creation events audit-only', () => {
    expect(
      normalizeMetaOperation({ ...input, systemActor: true }).category,
    ).toBe('other');
    expect(
      normalizeMetaOperation({ ...input, field: 'created' }).category,
    ).toBe('other');
    expect(normalizeMetaOperation({ ...input, before: 0 }).category).toBe(
      'other',
    );
  });
  it('rejects lossy numeric IDs and timezone-free timestamps before any write', () => {
    expect(() =>
      service.import({
        operations: [input, { ...input, objectId: 120249140890910527 }],
      }),
    ).toThrow();
    expect(db.listMetaOperations()).toHaveLength(0);
    expect(() =>
      normalizeMetaOperation({ ...input, occurredAt: '2026-01-05 09:00' }),
    ).toThrow();
  });
  it('excludes adjustment day and today; surfaces overlapping changes', () => {
    const op = { ...normalizeMetaOperation(input), linked: true };
    const next = normalizeMetaOperation({
      ...input,
      occurredAt: '2026-01-07T09:00:00+08:00',
    });
    const review = reviewMetaOperation(
      op,
      [
        snapshot('2026-01-04'),
        snapshot('2026-01-05'),
        snapshot('2026-01-06'),
        snapshot('2026-01-10'),
      ],
      [op, next],
      new Date('2026-01-10T10:00:00Z'),
    );
    expect(review.before.map((s) => s.dataDate)).toEqual(['2026-01-04']);
    expect(review.after.map((s) => s.dataDate)).toEqual(['2026-01-06']);
    expect(review.intervening).toEqual([next.id]);
  });
  it('late imports close the previous observation without declaring improvement', () => {
    db.saveCampaignSnapshot(snapshot('2026-01-04'));
    service.import({ operations: [input] });
    service.import({
      operations: [
        {
          ...input,
          occurredAt: '2026-01-06T09:00:00+08:00',
          before: 800,
          after: 350,
        },
      ],
    });
    const old = db.getDecisionRecord(
      `meta-${normalizeMetaOperation(input).id}`,
    );
    expect(old?.status).toBe('completed');
    expect(
      old && 'resultClassification' in old && old.resultClassification,
    ).toBeFalsy();
    expect(service.overview().items[0].operation.category).toBe('decrease');
  });
  it('keeps entity metadata version monotonic', () => {
    const entity = {
      accountId: input.accountId,
      id: input.objectId,
      campaignId: input.campaignId,
      level: 'campaign',
      name: 'test',
      objective: 'OUTCOME_APP_PROMOTION',
      fetchedAt: '2026-01-10T00:00:00Z',
    };
    service.import({ operations: [], entities: [entity] });
    service.import({
      operations: [],
      entities: [
        { ...entity, objective: 'OLD', fetchedAt: '2026-01-01T00:00:00Z' },
      ],
    });
    expect(db.listMetaEntities()[0].objective).toBe('OUTCOME_APP_PROMOTION');
  });
});
