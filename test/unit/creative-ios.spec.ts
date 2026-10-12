import {
  buildCreativeFunnelRows,
  type FunnelCohortUser,
} from '@server/modules/growth-decision/creative-funnel';
import {
  creativeCoverage,
  matchFunnelRows,
  sumFunnel,
} from '@shared/creative-analysis';
import {
  iosCreative,
  isMetaAttribution,
  parseCreativeTags,
} from '@shared/creative-tags';

const name =
  'Mellow-0923-FB-LN-ZX-EN-solomale-modern-stl-flirty-photo-pretty-rom-blackhair-tattoo-011-V2.mp4';
const user: FunnelCohortUser = {
  appId: 3,
  platform: 'ios',
  bundle: 'com.pixelflyapp.milo',
  userId: 'test',
  date: '2026-10-10',
  country: 'US',
};
const attr = {
  user_id: 'test',
  bundle_id: user.bundle,
  platform: 2,
  channel: 'xiye_Milo_ios_web_pruchase',
  campaign: 'campaign (123456)',
  adgroup: 'JP (123457)',
  creative: `${name} (52701123239817)`,
  ad_id: 'device-hash-not-ad-id',
};
const order = {
  user_id: 'test',
  bundle_id: user.bundle,
  platform: 2,
  event_date: user.date,
  action_desc: 'PURCHASED',
  env: 'Production',
  order_count: 1,
};
const make = (attribution = [attr], orders = [order]) =>
  buildCreativeFunnelRows([user], { attribution, orders, events: [] })[0];

test('iOS reads filename and numeric ad ID from creative, not adgroup or device ad_id', () => {
  const row = make();
  expect(row.creativeName).toBe(name);
  expect(row.creativeId).toBe('52701123239817');
  expect(row.tags.codes).toContain('solomale');
  expect(row.tags.codes).toContain('rom');
  expect(creativeCoverage(row)).toBe('可解析 V2');
  expect(parseCreativeTags(attr.creative)).toEqual(parseCreativeTags(name));
  expect(iosCreative('52699537282217')).toEqual({
    name: '',
    id: '52699537282217',
  });
  expect(iosCreative('old (4).mp4')).toEqual({ name: 'old (4).mp4', id: '' });
});

test('verified web alias is included in Meta drilldown without accepting unrelated web channels', () => {
  expect(isMetaAttribution(attr.channel)).toBe(true);
  expect(isMetaAttribution('unknown_ios_web_purchase')).toBe(false);
  expect(
    matchFunnelRows([make()], { source: 'meta', tags: ['solomale', 'rom'] }),
  ).toHaveLength(1);
});

test('iOS paid users count once and exclude sandbox, wrong platform, dates, bundles and refunds', () => {
  expect(make([attr], [order, order]).orders).toBe(1);
  for (const invalid of [
    { ...order, env: 'Sandbox' },
    { ...order, platform: 1 },
    { ...order, event_date: '2026-10-11' },
    { ...order, bundle_id: 'other' },
    { ...order, action_desc: 'REFUNDED' },
  ])
    expect(make([attr], [invalid]).orders).toBe(0);
  expect(make([{ ...attr, platform: 1 }]).attribution).toBe('unattributed');
});

test('old filenames, absent attribution, missing names and failed reads are distinct', () => {
  const old = make([{ ...attr, creative: 'old-image.mp4 (123456)' }]);
  const missing = make([
    { ...attr, channel: 'Organic', creative: '', adgroup: '' },
  ]);
  const idOnly = make([{ ...attr, creative: '123456' }]);
  expect(creativeCoverage(old)).toBe('有素材，无 V2 标签');
  expect(old.orders).toBe(1);
  expect(creativeCoverage(missing)).toBe('无素材归因');
  expect(creativeCoverage(idOnly)).toBe('有素材 ID，名称缺失');
  expect(creativeCoverage(make([]))).toBe('无素材归因');
  const failed = buildCreativeFunnelRows([user], {
    attribution: null,
    orders: null,
    events: [],
  })[0];
  expect(creativeCoverage(failed)).toBe('归因读取失败');
  expect(sumFunnel([old, failed]).orders).toBeNull();
  expect(
    creativeCoverage(make([attr, { ...attr, creative: 'other (123456)' }])),
  ).toBe('归因冲突');
});
