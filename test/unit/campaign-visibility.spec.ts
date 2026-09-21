import { verifiedNoSpend } from '@shared/campaign-visibility';
import type { BiPart } from '@shared/paid-growth.interface';

const campaign = { appId: 11, media: 'facebook', campaignId: '111' };
const row = {
  app_id: 11,
  media_source: 'facebook',
  campaign_id: '111',
  spend: 0,
};
const day = (
  date = '2026-09-22',
  rows: BiPart['rows'] = [row],
  state: BiPart['state'] = 'fresh',
) => ({ date, daily: { rows, state } });
describe('verified no-spend campaign visibility', () => {
  test('fresh and valid cached zero spend are hidden', () => {
    for (const state of ['fresh', 'cached'] as const)
      expect(
        verifiedNoSpend(
          [day(undefined, [row], state)],
          ['2026-09-22'],
        )(campaign),
      ).toBe(true);
  });
  test('revenue-only campaign is hidden only after complete daily result proves its absence', () => {
    expect(
      verifiedNoSpend([day(undefined, [])], ['2026-09-22'])(campaign),
    ).toBe(true);
    expect(
      verifiedNoSpend(
        [day(undefined, [], 'missing')],
        ['2026-09-22'],
      )(campaign),
    ).toBe(false);
  });
  test('failed, stale and unsupported queries never hide rows', () => {
    for (const state of ['missing', 'stale', 'unsupported'] as const)
      expect(
        verifiedNoSpend(
          [day(undefined, [row], state)],
          ['2026-09-22'],
        )(campaign),
      ).toBe(false);
  });
  test('missing or invalid spend is not zero', () => {
    for (const spend of [null, undefined, '', 'invalid', 0.00001, -1])
      expect(
        verifiedNoSpend(
          [day(undefined, [{ ...row, spend }])],
          ['2026-09-22'],
        )(campaign),
      ).toBe(false);
  });
  test('no netting positive and negative spend to zero', () => {
    expect(
      verifiedNoSpend(
        [
          day(undefined, [
            { ...row, spend: 1 },
            { ...row, spend: -1 },
          ]),
        ],
        ['2026-09-22'],
      )(campaign),
    ).toBe(false);
  });
  test('all requested dates must be present and verified', () => {
    expect(
      verifiedNoSpend([day()], ['2026-09-21', '2026-09-22'])(campaign),
    ).toBe(false);
    expect(
      verifiedNoSpend(
        [day(), day('2026-09-21', [], 'stale')],
        ['2026-09-21', '2026-09-22'],
      )(campaign),
    ).toBe(false);
    expect(
      verifiedNoSpend(
        [day(), day('2026-09-21')],
        ['2026-09-21', '2026-09-22'],
      )(campaign),
    ).toBe(true);
  });
  test('BI historical spend stays visible, adjustment today-only zero is hidden', () => {
    const days = [day('2026-09-21', [{ ...row, spend: 10 }]), day()];
    expect(verifiedNoSpend(days, ['2026-09-21', '2026-09-22'])(campaign)).toBe(
      false,
    );
    expect(verifiedNoSpend(days, ['2026-09-22'])(campaign)).toBe(true);
  });
  test('scope identity is product + media + campaign; unidentified rows prevent hiding', () => {
    expect(
      verifiedNoSpend(
        [day(undefined, [{ ...row, app_id: 12, spend: 10 }])],
        ['2026-09-22'],
      )(campaign),
    ).toBe(true);
    expect(
      verifiedNoSpend(
        [day(undefined, [{ ...row, campaign_id: '' }])],
        ['2026-09-22'],
      )(campaign),
    ).toBe(false);
    expect(
      verifiedNoSpend([day()], ['2026-09-22'])({ ...campaign, campaignId: '' }),
    ).toBe(false);
  });
});
