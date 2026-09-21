import {
  adjustmentBudgetUnits,
  adjustmentSnapshotMatches,
  readAdjustmentSnapshot,
  validateAdjustmentChange,
  type MetaAdjustmentSnapshot,
  type MetaGraphCall,
} from '@shared/meta-adjustment';

const target = {
  id: '111',
  accountId: '222',
  campaignId: '111',
  level: 'campaign' as const,
};
const snapshot: MetaAdjustmentSnapshot = {
  ...target,
  name: 'test',
  status: 'ACTIVE',
  effectiveStatus: 'ACTIVE',
  currency: 'USD',
  dailyBudget: '10000',
  budgetEditable: true,
  budgetReason: '',
};
describe('Meta adjustment guards', () => {
  test('existing campaign daily budget and adset-owned daily budget are editable', async () => {
    const campaignGraph: MetaGraphCall = async (id) =>
      id === '111'
        ? { id, account_id: '222', daily_budget: '6000', status: 'ACTIVE' }
        : { currency: 'USD' };
    expect(
      (await readAdjustmentSnapshot(target, campaignGraph)).budgetEditable,
    ).toBe(true);
    const adsetGraph: MetaGraphCall = async (id) =>
      id === '333'
        ? {
            id,
            account_id: '222',
            campaign_id: '111',
            daily_budget: '2000',
            status: 'PAUSED',
          }
        : id === '111'
          ? { daily_budget: '0', lifetime_budget: '0' }
          : { currency: 'USD' };
    expect(
      (
        await readAdjustmentSnapshot(
          { ...target, id: '333', level: 'adset' },
          adsetGraph,
        )
      ).budgetEditable,
    ).toBe(true);
  });
  test('lifetime budgets cannot accidentally be converted to daily budgets', async () => {
    const graph: MetaGraphCall = async (id) =>
      id === '111'
        ? { id, account_id: '222', lifetime_budget: '6000', status: 'ACTIVE' }
        : { currency: 'USD' };
    const result = await readAdjustmentSnapshot(target, graph);
    expect(result.budgetEditable).toBe(false);
    expect(result.budgetReason).toContain('总预算');
  });
  test('budget conversion is exact and rejects unsafe inputs', () => {
    expect(adjustmentBudgetUnits('10.29')).toBe('1029');
    for (const value of [
      '0',
      '-1',
      '1e3',
      '1.001',
      'Infinity',
      '9007199254740991',
    ])
      expect(() => adjustmentBudgetUnits(value)).toThrow();
  });
  test('ad creative has no budget, only ACTIVE/PAUSED accepted', () => {
    expect(() =>
      validateAdjustmentChange({
        before: {
          ...snapshot,
          level: 'ad',
          adsetId: '333',
          budgetEditable: false,
        },
        dailyBudget: '50',
      }),
    ).toThrow();
    expect(() =>
      validateAdjustmentChange({
        before: snapshot,
        status: 'DELETED' as 'ACTIVE',
      }),
    ).toThrow();
    expect(() => validateAdjustmentChange({ before: snapshot })).toThrow();
  });
  test('snapshot mismatch detects stale concurrent edits, ignores inherited status change', () => {
    expect(
      adjustmentSnapshotMatches(snapshot, { ...snapshot, dailyBudget: '9000' }),
    ).toBe(false);
    expect(
      adjustmentSnapshotMatches(snapshot, {
        ...snapshot,
        effectiveStatus: 'CAMPAIGN_PAUSED',
      }),
    ).toBe(true);
  });
  test('read verifies account ownership before anything can be written', async () => {
    const graph = jest.fn(async () => ({ id: '111', account_id: '999' }));
    await expect(readAdjustmentSnapshot(target, graph)).rejects.toThrow(
      '归属不匹配',
    );
    expect(graph).toHaveBeenCalledTimes(1);
  });
  test('adset under CBO cannot override parent budget', async () => {
    const graph: MetaGraphCall = jest.fn(async (id: string) =>
      id === '333'
        ? {
            id: '333',
            account_id: '222',
            campaign_id: '111',
            name: 'adset',
            status: 'ACTIVE',
            daily_budget: '2000',
          }
        : id === '111'
          ? { daily_budget: '10000' }
          : { currency: 'USD' },
    );
    const result = await readAdjustmentSnapshot(
      { ...target, level: 'adset', id: '333' },
      graph,
    );
    expect(result.budgetEditable).toBe(false);
    expect(result.budgetReason).toContain('系列统一预算');
  });
  test('non-USD budget is not silently treated as dollars', async () => {
    const graph: MetaGraphCall = async (id) =>
      id === '111'
        ? { id, account_id: '222', daily_budget: '500', status: 'ACTIVE' }
        : { currency: 'JPY' };
    expect((await readAdjustmentSnapshot(target, graph)).budgetEditable).toBe(
      false,
    );
  });
});
