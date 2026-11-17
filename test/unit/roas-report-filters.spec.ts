import {
  matchesRoasReport,
  roasReportChannels,
  roasChannelLabel,
} from '../../shared/roas-report-filters';
import type { RoasRow } from '../../shared/roas-report';
const row: RoasRow = {
  appId: 12,
  buyer: 'lzx',
  channel: 'google ads',
  date: '2026-11-16',
  spend: 100,
  days: [],
};
const scope = {
  buyer: 'lzx',
  channel: '',
  platform: 'all',
  start: '2026-11-16',
  end: '2026-11-16',
};
describe('ROAS channels follow paid-data metadata', () => {
  it('includes new catalog channels before ROAS data loads and discovers channels from results', () => {
    const channels = roasReportChannels(
      [
        { appId: 12, channel: 'facebook' },
        { appId: 12, channel: 'snapchat' },
      ],
      [{ appId: 12, channel: 'AppLovin' }],
      'android',
    );
    expect(channels).toEqual(['AppLovin', 'facebook', 'snapchat']);
    expect(
      roasReportChannels([{ appId: 3, channel: 'new_ios_channel' }], [], 'ios'),
    ).toEqual(['new_ios_channel']);
  });
  it('does not apply the old buyer-channel whitelist to ROAS rows', () => {
    expect(matchesRoasReport(row, scope)).toBe(true);
    expect(
      matchesRoasReport(
        { ...row, channel: 'snapchat' },
        { ...scope, channel: 'snapchat' },
      ),
    ).toBe(true);
    expect(
      matchesRoasReport(
        { ...row, buyer: 'new_buyer' },
        { ...scope, buyer: '' },
      ),
    ).toBe(true);
  });
  it('keeps Facebook Web separate and deduplicates source casing', () => {
    expect(
      roasReportChannels(
        [
          { appId: 12, channel: 'facebook' },
          { appId: 12, channel: 'facebook web' },
          { appId: 12, channel: 'Google Ads' },
        ],
        [
          { appId: 12, channel: 'facebook_web' },
          { appId: 12, channel: 'google ads' },
        ],
        'all',
      ),
    ).toEqual(['Google Ads', 'facebook', 'facebook_web']);
    expect(
      matchesRoasReport(
        { ...row, channel: 'facebook_web' },
        { ...scope, channel: 'facebook' },
      ),
    ).toBe(false);
    expect(matchesRoasReport(row, { ...scope, channel: 'Google Ads' })).toBe(
      true,
    );
    expect(roasChannelLabel('new_partner_channel')).toBe('new_partner_channel');
  });
  it('still applies date product and explicit buyer filters and hides unrelated product metadata', () => {
    for (const change of [
      { start: '2026-11-17' },
      { end: '2026-11-15' },
      { platform: 'ios' },
      { buyer: 'jsa' },
      { channel: 'tiktok' },
    ])
      expect(matchesRoasReport(row, { ...scope, ...change })).toBe(false);
    expect(
      roasReportChannels(
        [
          { appId: 3, channel: 'ios_only' },
          { appId: 99, channel: 'unrelated' },
        ],
        [{ appId: 12, channel: 'android_only' }],
        'ios',
      ),
    ).toEqual(['ios_only']);
  });
});
