import { resolveCampaignAccounts } from '@shared/meta-adjustment';
import { AdAdjustmentService } from '@server/modules/growth-decision/ad-adjustment.service';

test('campaign ownership uses only read-only Graph calls and rejects inaccessible/mismatched objects', async () => {
  const call = jest.fn(async (id: string, fields: unknown, post?: boolean) => {
    expect(post).not.toBe(true);
    if (id === '2') throw new Error('no permission');
    return {
      id: id === '3' ? '999' : id,
      account_id: '101',
      objective: 'OUTCOME_APP_PROMOTION',
    };
  });
  expect(await resolveCampaignAccounts(['1', '2', '3'], call)).toEqual({
    campaigns: [{ campaignId: '1', accountId: '101' }],
    unavailable: ['2', '3'],
  });
  await expect(resolveCampaignAccounts(['not-an-id'], call)).rejects.toThrow();
});
const q = {
  date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
  appId: '11',
  media: 'facebook',
  part: 'accounts' as const,
};
test('resolves only personal Doris visible campaign IDs, never queries forbidden DWD', async () => {
  const bi = {
    part: jest.fn().mockResolvedValue({
      state: 'fresh',
      rows: [{ campaign_id: '1' }, { campaign_id: '2' }],
    }),
  };
  const meta = {
    campaignAccounts: jest.fn().mockResolvedValue({
      ownerId: 'fjx-meta',
      campaigns: [{ campaignId: '1', accountId: '101' }],
      unavailable: ['2'],
    }),
  };
  const result = await new AdAdjustmentService(bi as never, meta as never).day(
    q,
  );
  expect(bi.part.mock.calls[0][0].dataset).toBe(
    'bi_ads.ads_paid_acquisition_daily',
  );
  expect(meta.campaignAccounts).toHaveBeenCalledWith(['1', '2']);
  expect(result.accounts.rows).toEqual([
    { app_id: 11, campaign_id: '1', advertiser_id: '101' },
  ]);
  expect(result.accounts.message).toContain('1 个系列');
});
test('no credential/permission fallback when personal Meta fails or Doris is incomplete', async () => {
  const bi = {
    part: jest
      .fn()
      .mockResolvedValue({ state: 'fresh', rows: [{ campaign_id: '1' }] }),
  };
  const meta = {
    campaignAccounts: jest.fn().mockRejectedValue(new Error('个人授权已失效')),
  };
  const service = new AdAdjustmentService(bi as never, meta as never);
  expect((await service.day(q)).accounts).toMatchObject({
    state: 'missing',
    rows: [],
  });
  bi.part.mockResolvedValue({ state: 'stale', rows: [{ campaign_id: '1' }] });
  meta.campaignAccounts.mockClear();
  expect((await service.day(q)).accounts.state).toBe('missing');
  expect(meta.campaignAccounts).not.toHaveBeenCalled();
  await service.day({ ...q, cacheOnly: '1' });
  expect(meta.campaignAccounts).not.toHaveBeenCalled();
});
test('ownership is paginated and includes identity for client-side switch detection', async () => {
  const bi = {
    part: jest.fn().mockResolvedValue({
      state: 'fresh',
      rows: Array.from({ length: 11 }, (_, i) => ({
        campaign_id: String(i + 1),
      })),
    }),
  };
  const meta = {
    campaignAccounts: jest
      .fn()
      .mockResolvedValueOnce({
        ownerId: 'first',
        campaigns: [{ campaignId: '1', accountId: '101' }],
      })
      .mockResolvedValueOnce({
        ownerId: 'second',
        campaigns: [{ campaignId: '11', accountId: '102' }],
      }),
  };
  const service = new AdAdjustmentService(bi as never, meta as never);
  expect((await service.day(q)).accounts).toMatchObject({
    state: 'fresh',
    accountOwnerId: 'first',
    accountNextOffset: 10,
  });
  expect(meta.campaignAccounts).toHaveBeenCalledTimes(1);
  const next = await service.day({ ...q, accountOffset: '10' });
  expect(next.accounts.accountOwnerId).toBe('second');
  expect(next.accounts.accountNextOffset).toBeUndefined();
});
