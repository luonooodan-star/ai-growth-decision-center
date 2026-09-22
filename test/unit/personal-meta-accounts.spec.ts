import {
  resolveCampaignAccounts,
  createMetaDisplayReader,
} from '@shared/meta-adjustment';
import {
  AdAdjustmentService,
  accountVerificationIds,
} from '@server/modules/growth-decision/ad-adjustment.service';

test('verification prioritizes spend, skips confirmed zero and retains unknown/negative spend', () => {
  expect(
    accountVerificationIds([
      { campaign_id: '1', spend: 0 },
      { campaign_id: '2', spend: 20 },
      { campaign_id: '3', spend: 100 },
      { campaign_id: '4' },
      { campaign_id: '5', spend: -1 },
      { campaign_id: '2', spend: 10 },
    ]),
  ).toEqual(['3', '2', '4', '5']);
});

test('display reads deduplicate, isolate credentials, expire and clear after writes', async () => {
  const reader = createMetaDisplayReader();
  const graph = jest.fn().mockResolvedValue({ id: '1' });
  await Promise.all(
    Array.from({ length: 10 }, () =>
      reader.read('identity-a', graph, '1', { fields: 'id' }),
    ),
  );
  expect(graph).toHaveBeenCalledTimes(1);
  await reader.read('identity-b', graph, '1', { fields: 'id' });
  expect(graph).toHaveBeenCalledTimes(2);
  reader.clear();
  await reader.read('identity-a', graph, '1', { fields: 'id' });
  expect(graph).toHaveBeenCalledTimes(3);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
  try {
    await reader.read('identity-a', graph, '1', { fields: 'id' });
  } finally {
    clock.mockRestore();
  }
  expect(graph).toHaveBeenCalledTimes(4);
});

test('display requests have at most four concurrent Graph reads; failures are not cached', async () => {
  const reader = createMetaDisplayReader();
  let active = 0,
    peak = 0;
  const graph = jest.fn(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return {};
  });
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      reader.read('a', graph, String(i), {}),
    ),
  );
  expect(peak).toBe(4);
  const failed = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(reader.read('b', failed, 'me', {})).rejects.toThrow('offline');
  await expect(reader.read('b', failed, 'me', {})).rejects.toThrow('offline');
  expect(failed).toHaveBeenCalledTimes(2);
});

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
  const first = await service.day(q);
  expect(first.accounts).toMatchObject({
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
  const first = await service.day(q);
  expect(first.accounts).toMatchObject({
    state: 'fresh',
    accountOwnerId: 'first',
    accountNextOffset: 10,
  });
  expect(meta.campaignAccounts).toHaveBeenCalledTimes(1);
  bi.part.mockResolvedValue({ state: 'fresh', rows: [] });
  const next = await service.day({
    ...q,
    accountOffset: '10',
    accountSession: first.accounts.accountSession,
  });
  expect(next.accounts.accountOwnerId).toBe('second');
  expect(next.accounts.accountNextOffset).toBeUndefined();
  expect(bi.part).toHaveBeenCalledTimes(1);
  expect(
    (
      await service.day({
        ...q,
        accountOffset: '10',
        country: 'IN',
        accountSession: first.accounts.accountSession,
      })
    ).accounts.state,
  ).toBe('missing');
});
