import { MellowSharingService } from '../../server/modules/growth-decision/mellow-sharing.service';
import { CreativeAnalysisService } from '../../server/modules/growth-decision/creative-analysis.service';
import { PaidGrowthService } from '../../server/modules/growth-decision/paid-growth.service';
import { centerIdentity } from '../../server/common/utils/center-identity';
import {
  personalDataIdentity,
  personalDorisStatus,
  personalScopeKey,
} from '../../server/common/utils/personal-doris';
import { isMellowSharedRoute } from '../../server/common/utils/mellow-sharing';
import type { BiPart } from '@shared/paid-growth.interface';

jest.mock('../../server/common/utils/personal-doris', () => {
  const actual = jest.requireActual('../../server/common/utils/personal-doris');
  return {
    ...actual,
    personalDorisStatus: jest.fn(() => ({
      configured: true,
      revision: 'owner-r1',
    })),
    runPersonalData: (name: string, action: () => unknown) =>
      actual.personalDataIdentity.run(
        { username: name, revision: 'owner-r1' },
        action,
      ),
  };
});
const asUser = <T>(user: string, f: () => T) =>
  centerIdentity.run(user, () =>
    personalDataIdentity.run({ username: user, revision: 'r1' }, f),
  );
const date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const query = { start: date, end: date, platform: 'all' as const };
function setup() {
  const source = { id: 'source-id', state: 'running', progress: 'reading' };
  const analysis = {
    start: jest.fn(() => source),
    status: jest.fn(() => source),
    cancel: jest.fn(),
  };
  const bi = {
    part: jest.fn<
      Promise<BiPart>,
      [Record<string, unknown>, boolean, number]
    >(),
  };
  const service = new MellowSharingService(
    analysis as unknown as CreativeAnalysisService,
    bi as unknown as PaidGrowthService,
  );
  return { service, analysis, bi };
}
beforeEach(() =>
  jest.mocked(personalDorisStatus).mockReturnValue({
    configured: true,
    revision: 'owner-r1',
    updatedAt: undefined,
  }),
);
it('grants only the requested users and fixed analysis routes, not ad writes or generic BI', () => {
  const { service, analysis } = setup();
  for (const name of ['vvv', 'FJX', 'anonymous'])
    expect(() => asUser(name, () => service.start(query))).toThrow('未获');
  expect(analysis.start).not.toHaveBeenCalled();
  expect(
    isMellowSharedRoute('POST', '/api/growth-decision/analysis/query', 'fjx'),
  ).toBe(true);
  expect(
    isMellowSharedRoute('POST', '/api/growth-decision/analysis/query', 'vvv'),
  ).toBe(false);
  expect(
    isMellowSharedRoute(
      'POST',
      '/api/growth-decision/adjustments/submit',
      'fjx',
    ),
  ).toBe(false);
  expect(isMellowSharedRoute('GET', '/api/growth-decision/bi', 'jsa')).toBe(
    false,
  );
});
it('executes fixed queries in the owner scope, ignores privilege parameters and force refresh', () => {
  const { service, analysis } = setup();
  analysis.start.mockImplementation(() => {
    expect(personalScopeKey()).toBe('growth:owner-r1');
    return { id: 'source-id', state: 'running', progress: '' };
  });
  asUser('fjx', () =>
    service.start({
      ...query,
      refresh: true,
      owner: 'admin',
      dataset: 'secrets',
    } as typeof query),
  );
  expect(analysis.start).toHaveBeenCalledWith({ ...query, refresh: false });
  expect(() =>
    asUser('fjx', () =>
      service.start({ ...query, platform: 'other' as 'all' }),
    ),
  ).toThrow();
  expect(() =>
    asUser('fjx', () =>
      service.start({ ...query, start: '2020-01-01', end: '2020-01-01' }),
    ),
  ).toThrow('90');
});
it('isolates viewer handles; stopping one viewer does not cancel the shared source', () => {
  const { service, analysis } = setup();
  const a = asUser('fjx', () => service.start(query));
  const b = asUser('jsa', () => service.start(query));
  expect(a.id).not.toBe(b.id);
  expect(() => asUser('jsa', () => service.status(a.id))).toThrow();
  expect(asUser('fjx', () => service.cancel(a.id)).state).toBe('cancelled');
  expect(asUser('jsa', () => service.status(b.id)).state).toBe('running');
  expect(analysis.cancel).not.toHaveBeenCalled();
  jest.mocked(personalDorisStatus).mockReturnValue({
    configured: true,
    revision: 'changed',
    updatedAt: undefined,
  });
  expect(() => asUser('jsa', () => service.status(b.id))).toThrow('失效');
});
it('fails closed when growth credentials are revoked', () => {
  const { service, bi } = setup();
  jest.mocked(personalDorisStatus).mockReturnValue({
    configured: false,
    revision: 'revoked',
    updatedAt: undefined,
  });
  expect(() => asUser('fjx', () => service.roas(query))).toThrow('未配置');
  expect(bi.part).not.toHaveBeenCalled();
});
it('coalesces ROAS reads across viewers and includes organic plus Web revenue without averaging ratios', async () => {
  const { service, bi } = setup();
  bi.part.mockImplementation(async (args) => ({
    state: 'cached',
    updatedAt: '2026-10-10T00:00:00Z',
    rows:
      args.dataset === 'bi_ads.ads_paid_acquisition_daily'
        ? [
            { app_id: 3, media_source: 'facebook', spend: 100 },
            { app_id: 3, media_source: 'facebook_web', spend: 100 },
          ]
        : [
            { app_id: 3, media_source: 'facebook', metric_value: 20 },
            { app_id: 3, media_source: 'facebook_web', metric_value: 30 },
            { app_id: 3, media_source: 'organic', metric_value: 50 },
          ],
  }));
  const a = asUser('fjx', () => service.roas(query));
  const b = asUser('jsa', () => service.roas(query));
  expect(a).toBe(b);
  expect(await a).toMatchObject({
    spend: 200,
    revenue: 100,
    organicRevenue: 50,
    roas: 50,
  });
  expect(bi.part).toHaveBeenCalledTimes(2);
  for (const [args, force] of bi.part.mock.calls) {
    expect(JSON.parse(String(args.filters_json)).app_id).toBe(3);
    expect(force).toBe(false);
  }
});
it("refreshes yesterday's backfilled ROAS and bypasses both source caches on manual refresh", async () => {
  const { service, bi } = setup();
  bi.part.mockResolvedValue({
    state: 'fresh',
    updatedAt: new Date().toISOString(),
    rows: [{ app_id: 3, media_source: 'organic', spend: 10, metric_value: 5 }],
  });
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Shanghai',
  });
  const yesterday = new Date(Date.parse(today) - 86400000)
    .toISOString()
    .slice(0, 10);
  await asUser('fjx', () =>
    service.roas({ start: yesterday, end: yesterday, platform: 'ios' }),
  );
  expect(bi.part).toHaveBeenCalledTimes(2);
  for (const [, force, ttl] of bi.part.mock.calls) {
    expect(force).toBe(false);
    expect(ttl).toBe(300000);
  }
  bi.part.mockClear();
  await asUser('jsa', () =>
    service.roas({
      start: yesterday,
      end: yesterday,
      platform: 'ios',
      refresh: true,
    }),
  );
  expect(bi.part).toHaveBeenCalledTimes(2);
  for (const [, force, ttl] of bi.part.mock.calls) {
    expect(force).toBe(true);
    expect(ttl).toBe(300000);
  }
});
it('does not present missing data or zero spend as a zero ROAS', async () => {
  const { service, bi } = setup();
  bi.part.mockResolvedValue({ state: 'missing', rows: [] });
  expect(await asUser('growth', () => service.roas(query))).toMatchObject({
    spend: null,
    revenue: null,
    roas: null,
  });
  bi.part.mockResolvedValue({
    state: 'fresh',
    rows: [{ app_id: 3, media_source: 'organic', spend: 0, metric_value: 0 }],
  });
  expect(await asUser('fjx', () => service.roas(query))).toMatchObject({
    spend: 0,
    revenue: 0,
    roas: null,
  });
});
it('rejects cross-product returned rows', async () => {
  const { service, bi } = setup();
  bi.part.mockResolvedValue({
    state: 'fresh',
    rows: [
      { app_id: 12, media_source: 'organic', spend: 100, metric_value: 100 },
    ],
  });
  expect(await asUser('fjx', () => service.roas(query))).toMatchObject({
    spend: null,
    revenue: null,
    roas: null,
  });
});
