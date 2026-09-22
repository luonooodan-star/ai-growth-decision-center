import {
  activeOperationAnchors,
  periodicObservation,
} from '@server/modules/growth-decision/operation-tracking';
import type {
  MetaOperation,
  CampaignDailySnapshot,
} from '@shared/api.interface';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { MetaOperationsService } from '@server/modules/growth-decision/meta-operations.service';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MetaAdjustmentJob } from '@shared/meta-adjustment';

const op: MetaOperation = {
  id: 'op',
  source: 'adjustment_page',
  deliveryStatus: 'ACTIVE',
  accountId: '1',
  campaignId: '2',
  objectId: '3',
  objectName: 'adset',
  objectLevel: 'adset',
  actorId: '4',
  actorName: 'fjx',
  systemActor: false,
  occurredAt: '2026-09-22T00:00:00Z',
  importedAt: '2026-09-22T00:00:00Z',
  accountTimezone: 'UTC',
  eventType: 'budget',
  field: 'budget',
  before: 100,
  after: 120,
  raw: '{}',
  category: 'increase',
  linked: true,
  productId: 'p',
};
const snapshot: CampaignDailySnapshot = {
  key: 'k',
  productId: 'p',
  accountId: '1',
  campaignId: '2',
  campaignName: 'campaign',
  dataDate: '2026-09-22',
  fetchedAt: '2026-09-22T03:01:00Z',
  metrics: { spend: 100, d0_roas: 1.1 },
  countries: [],
  breakdowns: [],
  qualityIssues: [],
};
test('successful adjustments durably capture anchors, periodic data and campaign history without duplicates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operation-tracking-'));
  const prior = process.env.GROWTH_DATABASE_PATH;
  process.env.GROWTH_DATABASE_PATH = join(directory, 'db.sqlite');
  let db = new LocalDatabaseService();
  jest.useFakeTimers().setSystemTime(new Date('2026-09-22T03:02:00Z'));
  try {
    const product = db.listProducts()[0];
    const current = { ...snapshot, productId: product.id };
    db.saveCampaignSnapshot(current);
    const before = {
      id: '3',
      accountId: '1',
      campaignId: '2',
      level: 'adset' as const,
      name: 'adset',
      status: 'ACTIVE',
      effectiveStatus: 'ACTIVE',
      currency: 'USD',
      dailyBudget: '10000',
      budgetEditable: true,
      budgetReason: '',
    };
    const job: MetaAdjustmentJob = {
      id: 'job',
      ownerId: '4',
      centerUsername: 'fjx',
      state: 'completed',
      createdAt: op.occurredAt,
      items: [
        {
          before,
          after: { ...before, dailyBudget: '12000' },
          dailyBudget: '120',
          state: 'succeeded',
          startedAt: op.occurredAt,
          completedAt: op.occurredAt,
          evidence: {
            productId: product.id,
            capturedAt: op.occurredAt,
            note: 'missing baseline',
            strategies: [],
          },
        },
      ],
    };
    db.saveAdjustmentJob(job);
    db.saveAdjustmentJob(job);
    expect(db.listOperationObservations('1', '2')).toHaveLength(1);
    const service = new MetaOperationsService(db);
    expect(service.trackingDueProducts()).toEqual([product.id]);
    service.captureSnapshots(product.id);
    service.captureSnapshots(product.id);
    expect(db.listOperationObservations('1', '2')).toHaveLength(2);
    expect(service.trackingDueProducts()).toEqual([]);
    expect(service.overview(1, 'increase', product.id).total).toBe(1);
    expect(service.overview(1, 'decrease', product.id).total).toBe(0);
    expect(service.timeline('adjustment-job-0-budget').operations).toHaveLength(
      1,
    );
    db.onModuleDestroy();
    db = new LocalDatabaseService();
    expect(db.listOperationObservations('1', '2')).toHaveLength(2);
    expect(db.listOperationObservations('other-account', '2')).toHaveLength(0);
  } finally {
    db.onModuleDestroy();
    jest.useRealTimers();
    if (prior === undefined) delete process.env.GROWTH_DATABASE_PATH;
    else process.env.GROWTH_DATABASE_PATH = prior;
    rmSync(directory, { recursive: true, force: true });
  }
});
test('3h observations require fresh matched snapshots and deduplicate persisted slots', () => {
  expect(
    periodicObservation(op, [], [snapshot], new Date('2026-09-22T02:59:00Z')),
  ).toBeUndefined();
  const point = periodicObservation(
    op,
    [],
    [snapshot],
    new Date('2026-09-22T03:02:00Z'),
  )!;
  expect(point.snapshot?.metrics.d0_roas).toBe(1.1);
  expect(
    periodicObservation(
      op,
      [point],
      [snapshot],
      new Date('2026-09-22T03:03:00Z'),
    ),
  ).toBeUndefined();
  expect(
    periodicObservation(op, [], [snapshot], new Date('2026-09-22T06:02:00Z')),
  ).toBeUndefined();
  expect(
    periodicObservation(
      op,
      [],
      [{ ...snapshot, accountId: 'other' }],
      new Date('2026-09-22T03:02:00Z'),
    ),
  ).toBeUndefined();
});
test('new adjustments reset anchors; child pause does not stop sibling, campaign pause stops children', () => {
  const sibling = { ...op, id: 'sibling', objectId: '5' };
  const pause = {
    ...op,
    id: 'stop',
    field: 'status' as const,
    category: 'pause' as const,
    deliveryStatus: 'PAUSED',
    occurredAt: '2026-09-22T01:00:00Z',
  };
  expect(activeOperationAnchors([op, sibling, pause]).map((o) => o.id)).toEqual(
    ['sibling'],
  );
  expect(
    activeOperationAnchors([
      op,
      sibling,
      { ...pause, objectId: '2', objectLevel: 'campaign' },
    ]),
  ).toEqual([]);
  const resume = {
    ...pause,
    id: 'resume',
    category: 'resume' as const,
    deliveryStatus: 'ACTIVE',
    occurredAt: '2026-09-22T02:00:00Z',
  };
  expect(activeOperationAnchors([op, pause, resume]).map((o) => o.id)).toEqual([
    'resume',
  ]);
  expect(
    activeOperationAnchors([
      op,
      { ...op, id: 'new', occurredAt: '2026-09-22T01:00:00Z' },
    ]).map((o) => o.id),
  ).toEqual(['new']);
});
test('adset pause stops its ads, unknown state is not treated as active', () => {
  const ad = {
    ...op,
    id: 'ad',
    objectId: '9',
    adsetId: '3',
    objectLevel: 'ad' as const,
  };
  expect(
    activeOperationAnchors([
      ad,
      { ...op, category: 'pause', deliveryStatus: 'PAUSED' },
    ]),
  ).toEqual([]);
  expect(
    activeOperationAnchors([{ ...op, deliveryStatus: undefined }]),
  ).toEqual([]);
});
