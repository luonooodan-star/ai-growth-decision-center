import { parseCreativeTags, CREATIVE_TAGS } from '@shared/creative-tags';
import {
  groupCreativeFunnel,
  matchFunnelRows,
  nextCreativeTags,
  sumFunnel,
} from '@shared/creative-analysis';
import {
  buildCreativeFunnelRows,
  funnelCohort,
  type FunnelCohortUser,
} from '../../server/modules/growth-decision/creative-funnel';
import type { BiRawRow } from '@shared/paid-growth.interface';

const filename =
  'mellow_img_solomale_dark_mafia_dom_kw_semi_masc_lux_suit_01_v2.png';
const user = (userId: string): FunnelCohortUser => ({
  appId: 12,
  platform: 'android',
  bundle: 'com.pixelfly.mellow',
  userId,
  date: '2026-09-25',
  country: 'US',
});
const event = (
  userId: string,
  name: string,
  n = 1,
  character = 'a',
): BiRawRow => ({
  app_id: 12,
  event_date: '2026-09-25',
  resolved_user_id: userId,
  event_name: name,
  event_count: n,
  character_id: character,
});
const attr = (userId: string, name = filename): BiRawRow => ({
  user_id: userId,
  bundle_id: 'com.pixelfly.mellow',
  channel: 'Facebook Installs',
  campaign: 'campaign',
  adgroup: name,
  creative: name,
});
const order = (userId: string): BiRawRow => ({
  user_id: userId,
  bundle_id: 'com.pixelfly.mellow',
  event_date: '2026-09-25',
  action_desc: 'PURCHASED',
  env: 'Production',
  order_count: 1,
});

describe('V2 tag vocabulary and parsing', () => {
  it('preserves the original V2 vocabulary and handles exact codes and filenames', () => {
    const parsed = parseCreativeTags(filename.toUpperCase());
    expect(parsed.version).toBe('v2');
    expect(parsed.codes).toHaveLength(9);
    expect(parsed.codes).toContain('mafia');
    expect(parsed.unknown).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(CREATIVE_TAGS.dark.groups).toEqual(['category', 'mood']);
    expect(CREATIVE_TAGS.malefemale).toBeDefined();
    expect(CREATIVE_TAGS.duomf).toBeUndefined();
  });
  it('ignores deployed metadata, flags unknowns, does not guess from substrings', () => {
    const parsed = parseCreativeTags(
      'Mellow_0925_FB_LN_fjx_EN_solomale_darkish_mafia_aiboy_01_v2.mp4',
    );
    expect(parsed.codes).toEqual(['solomale', 'mafia']);
    expect(parsed.unknown).toEqual(['darkish', 'aiboy']);
    expect(parsed.codes).not.toContain('dark');
    expect(parseCreativeTags(filename.replace('_v2', '')).codes).toEqual([]);
    expect(
      parseCreativeTags('mellow_img_solomale_dark_dark_01_v2').warnings,
    ).toContain('含重复代码');
  });
});

describe('D0 user funnel', () => {
  it('deduplicates first-open users within product and range, and tracks missing identities', () => {
    const raw = (id: string, day: string, app = 12) => ({
      app_id: app,
      resolved_user_id: id,
      event_date: day,
      geo_country: 'US',
      event_count: 1,
    });
    const cohort = funnelCohort([
      raw('1', '2026-09-26'),
      raw('1', '2026-09-25'),
      raw('1', '2026-09-25', 3),
      raw('', '2026-09-25'),
    ]);
    expect(cohort.users).toHaveLength(2);
    expect(cohort.users[0].date).toBe('2026-09-25');
    expect(cohort.duplicates).toBe(1);
    expect(cohort.excluded).toBe(1);
  });
  it('requires same-character depth and intersects the pay funnel independently of orders', () => {
    const rows = buildCreativeFunnelRows([user('a'), user('b'), user('c')], {
      events: [
        event('a', 'chat_page_send_message_success', 3, 'x'),
        event('a', 'chat_page_send_message_success', 3, 'y'),
        event('b', 'chat_page_send_message_success', 20),
        event('a', 'sub_success'),
        event('b', 'sub_show'),
        event('b', 'pur_click'),
        event('b', 'pur_succ'),
      ],
      attribution: [attr('a'), attr('b'), attr('c')],
      orders: [order('c'), order('c')],
    });
    expect(sumFunnel(rows)).toEqual({
      users: 3,
      chat: 2,
      chat5: 1,
      chat20: 1,
      payShow: 1,
      payClick: 1,
      paySuccess: 1,
      successAny: 2,
      orders: 1,
    });
    expect(JSON.stringify(rows)).not.toContain('resolved_user_id');
  });
  it('never joins behavior/orders across product, date, or purchase environment', () => {
    const rows = buildCreativeFunnelRows([user('a')], {
      events: [
        { ...event('a', 'sub_success'), app_id: 3 },
        {
          ...event('a', 'chat_page_send_message_success', 20),
          event_date: '2026-09-26',
        },
      ],
      attribution: [{ ...attr('a'), bundle_id: 'other.app' }],
      orders: [
        { ...order('a'), order_count: 0 },
        { ...order('a'), env: 'Sandbox' },
        { ...order('a'), bundle_id: 'other.app' },
        { ...order('a'), event_date: '2026-09-26' },
      ],
    });
    expect(rows[0]).toMatchObject({
      chat: 0,
      orders: 0,
      successAny: 0,
      attribution: 'unattributed',
    });
  });
  it('does not turn missing sources or unknown character identity into zero', () => {
    expect(
      buildCreativeFunnelRows([user('a')], {
        events: null,
        attribution: null,
        orders: null,
      })[0],
    ).toMatchObject({
      users: 1,
      attribution: 'unavailable',
      chat: null,
      orders: null,
    });
    const missingCharacter = buildCreativeFunnelRows([user('a')], {
      events: [event('a', 'chat_page_send_message_success', 20, '')],
      attribution: [],
      orders: [],
    })[0];
    expect(missingCharacter).toMatchObject({
      chat: 1,
      chat5: null,
      chat20: null,
    });
  });
  it('deduplicates identical attribution rows and exposes conflicting assignments without choosing a tag', () => {
    const common = { events: [], orders: [] };
    expect(
      buildCreativeFunnelRows([user('a')], {
        ...common,
        attribution: [attr('a'), attr('a')],
      })[0].attribution,
    ).toBe('matched');
    const row = buildCreativeFunnelRows([user('a')], {
      ...common,
      attribution: [attr('a'), attr('a', 'different')],
    })[0];
    expect(row.attribution).toBe('ambiguous');
    expect(row.tags.codes).toEqual([]);
  });
});

describe('progressive local AND drilldown', () => {
  const rows = buildCreativeFunnelRows([user('a'), user('b'), user('c')], {
    events: [],
    orders: [order('a')],
    attribution: [
      attr('a', 'mellow_img_solomale_mafia_dark_01_v2'),
      attr('b', 'mellow_img_solomale_mafia_rom_01_v2'),
      attr('c', 'mellow_img_solofemale_rom_01_v2'),
    ],
  });
  it('only offers co-occurring tags and calculates exact intersections, including within a dimension', () => {
    const next = nextCreativeTags(rows, ['mafia']);
    expect(next.map((item) => item.tag)).not.toContain('mafia');
    expect(next.find((item) => item.tag === 'solomale')?.users).toBe(2);
    expect(next.find((item) => item.tag === 'rom')?.users).toBe(1);
    expect(next.some((item) => item.tag === 'solofemale')).toBe(false);
    expect(
      sumFunnel(matchFunnelRows(rows, { tags: ['mafia', 'dark'] })).users,
    ).toBe(1);
    expect(
      sumFunnel(matchFunnelRows(rows, { tags: ['dark', 'rom'] })).users,
    ).toBe(0);
    expect(sumFunnel(matchFunnelRows(rows, { tags: ['mafia'] })).users).toBe(2);
  });
  it('combines source/country/platform conditions and preserves nulls in sums', () => {
    expect(
      matchFunnelRows(rows, { country: 'JP', tags: ['mafia'], source: 'meta' }),
    ).toEqual([]);
    expect(matchFunnelRows(rows, { platform: 'ios' })).toEqual([]);
    expect(
      sumFunnel([{ ...rows[0], orders: null }, rows[1]]).orders,
    ).toBeNull();
    expect(groupCreativeFunnel(rows, 'country')[0].users).toBe(3);
  });
});
