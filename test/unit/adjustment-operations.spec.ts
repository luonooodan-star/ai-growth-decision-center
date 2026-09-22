import {
  adjustmentOperations,
  mergeOperationSources,
} from '@server/modules/growth-decision/adjustment-operations';
import type {
  MetaAdjustmentJob,
  MetaAdjustmentSnapshot,
} from '@shared/meta-adjustment';
const before: MetaAdjustmentSnapshot = {
  id: '11',
  campaignId: '11',
  accountId: '22',
  level: 'campaign',
  name: 'fixture',
  status: 'ACTIVE',
  effectiveStatus: 'ACTIVE',
  currency: 'USD',
  dailyBudget: '6000',
  budgetEditable: true,
  budgetReason: '',
};
const job = (): MetaAdjustmentJob => ({
  id: 'job',
  ownerId: '33',
  createdAt: '2026-09-21T01:00:00Z',
  state: 'completed',
  items: [
    {
      before,
      after: { ...before, status: 'PAUSED', dailyBudget: '4000' },
      status: 'PAUSED',
      dailyBudget: '40',
      state: 'succeeded',
      completedAt: '2026-09-21T01:01:00Z',
      evidence: {
        capturedAt: '2026-09-21T01:00:00Z',
        productId: 'p',
        note: 'captured',
      },
    },
  ],
});
test('successful status/budget changes produce deterministic separate local evidence', () => {
  const ops = adjustmentOperations([job()]);
  expect(ops).toHaveLength(2);
  expect(ops.map((o) => o.category)).toEqual(['decrease', 'pause']);
  expect(ops[0].source).toBe('adjustment_page');
  expect(ops[0].before).toBe(6000);
  expect(ops[0].productId).toBe('p');
  expect(adjustmentOperations([job()])).toEqual(ops);
});
test('failed uncertain pending and preview do not become successful measures', () => {
  for (const state of ['failed', 'uncertain', 'pending', 'running'] as const) {
    const j = job();
    j.items[0].state = state;
    expect(adjustmentOperations([j])).toEqual([]);
  }
});
test('resume has its own category; missing old baseline never invented', () => {
  const j = job();
  j.items[0] = {
    before: { ...before, status: 'PAUSED' },
    after: before,
    status: 'ACTIVE',
    state: 'succeeded',
    completedAt: j.createdAt,
  };
  const [o] = adjustmentOperations([j]);
  expect(o.category).toBe('resume');
  expect(o.capturedEvidence).toBeUndefined();
});
test('historical imports retained but exact local mirror deduplicated', () => {
  const local = adjustmentOperations([job()]);
  const mirror = { ...local[0], id: 'import', source: 'meta_import' as const };
  expect(mergeOperationSources(local, [mirror])).toHaveLength(2);
  expect(
    mergeOperationSources(local, [{ ...mirror, actorId: 'different' }]),
  ).toHaveLength(3);
});
