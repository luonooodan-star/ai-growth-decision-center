import type {
  CampaignDailySnapshot,
  GrowthDecisionCase,
  GrowthProduct,
} from '@shared/api.interface';
import { reconcileCampaignHistory } from '@server/modules/growth-decision/campaign-history';
import { buildCampaignCard } from '@server/modules/growth-decision/campaign-decision-engine';
import { CampaignDecisionService } from '@server/modules/growth-decision/campaign-decision.service';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { GrowthDecisionService } from '@server/modules/growth-decision/growth-decision.service';
import { GrowthMavisAnalysisService } from '@server/modules/growth-decision/growth-mavis-analysis.service';

const oldSnapshot = (): CampaignDailySnapshot => ({
  key: 'unresolved',
  productId: 'product',
  campaignId: 'series',
  campaignName: 'Series',
  countries: ['IN', 'PK'],
  dataDate: '2026-09-06',
  fetchedAt: '2026-09-07T01:00:00Z',
  metrics: { spend: 50 },
  breakdowns: [],
  qualityIssues: ['账户未定位', 'cohort 明细达到查询上限'],
});
const resolvedSnapshot = (): CampaignDailySnapshot => ({
  ...oldSnapshot(),
  key: 'resolved',
  accountId: 'account',
  fetchedAt: '2026-09-07T02:00:00Z',
  qualityIssues: [],
  metrics: { spend: 50, d0_roas: 0.9, adjust_installs: 500 },
});

describe('campaign history reconciliation', () => {
  it('uses resolved data once without adding duplicate spend or mutating history', () => {
    const source = [oldSnapshot(), resolvedSnapshot()];
    const before = JSON.stringify(source);
    const groups = reconcileCampaignHistory(source);
    expect(groups).toHaveLength(1);
    expect(groups[0].relatedKeys).toEqual(['resolved', 'unresolved']);
    expect(groups[0].snapshots[0].metrics).toMatchObject({
      spend: 50,
      d0_roas: 0.9,
    });
    expect(JSON.stringify(source)).toBe(before);
    expect(reconcileCampaignHistory(source)).toEqual(groups);
    expect(reconcileCampaignHistory([...source].reverse())).toEqual(groups);
  });

  it.each([
    ['different product', { productId: 'other' }],
    ['different campaign with same name', { campaignId: 'other' }],
    ['different countries', { countries: ['IN'] }],
    ['different day', { dataDate: '2026-09-05' }],
    ['older fetch', { fetchedAt: '2026-09-06T02:00:00Z' }],
    ['missing metric', { metrics: { d0_roas: 0.9 } }],
    ['failed integrity check', { qualityIssues: ['incomplete'] }],
  ] as Array<[string, Partial<CampaignDailySnapshot>]>)(
    'keeps both for %s',
    (_label, change) => {
      expect(
        reconcileCampaignHistory([
          oldSnapshot(),
          { ...resolvedSnapshot(), ...change },
        ]),
      ).toHaveLength(2);
    },
  );

  it('does not choose between multiple accounts or discard uncovered historical days', () => {
    expect(
      reconcileCampaignHistory([
        oldSnapshot(),
        resolvedSnapshot(),
        {
          ...resolvedSnapshot(),
          key: 'second-account',
          accountId: 'second',
        },
      ]),
    ).toHaveLength(3);
    expect(
      reconcileCampaignHistory([
        oldSnapshot(),
        {
          ...oldSnapshot(),
          dataDate: '2026-09-05',
        },
        resolvedSnapshot(),
      ]),
    ).toHaveLength(2);
  });

  it('retains old pending measures on the resolved card and blocks duplicate action', () => {
    const product = {
      targetMetric: 'd0_roas',
      dataDelayMinutes: 60,
      metrics: [{ key: 'd0_roas', lowerBound: 0.7 }],
    } as GrowthProduct;
    const order = {
      id: 'old-order',
      status: 'awaiting_execution',
      campaignExecution: { campaignKey: 'unresolved', state: 'pending' },
    } as GrowthDecisionCase;
    const group = reconcileCampaignHistory([
      oldSnapshot(),
      resolvedSnapshot(),
    ])[0];
    const card = buildCampaignCard(
      product,
      group.snapshots,
      [order],
      new Date('2026-09-07T02:00:00Z'),
      group.relatedKeys,
    );
    expect(card.recentOrders).toEqual([order]);
    expect(card.blockers.join()).toContain('已有待执行');
    expect(order.campaignExecution?.campaignKey).toBe('unresolved');
    const source = [oldSnapshot(), resolvedSnapshot()];
    const database = {
      getProduct: () => ({ ...product, id: 'product' }),
      listCampaignSnapshots: () => source,
      listDecisionRecords: () => [order],
      listMetaOperations: () => [],
      listMetaEntities: () => [],
    } as unknown as LocalDatabaseService;
    const service = new CampaignDecisionService(
      database,
      {} as GrowthDecisionService,
      {} as GrowthMavisAnalysisService,
    );
    const board = service.board('product');
    expect(board.items).toHaveLength(1);
    expect(board.items[0].recentOrders).toEqual([order]);
    expect(board.items[0].evidence.join()).toContain(
      '旧未定位卡片不再重复展示',
    );
    expect(database.listCampaignSnapshots('product')).toHaveLength(2);
  });
});
