import {
  matchesReferenceReport,
  reportChannel,
  reportChannels,
} from '../../shared/reference-report-filters';
const scope = {
  buyer: '',
  channel: '',
  platform: 'all',
  start: '2026-11-01',
  end: '2026-11-12',
};
const row = {
  buyer: 'lzx',
  channel: 'TikTok SAN',
  platform: 'android',
  date: '2026-11-11',
};
describe('original report filter contract', () => {
  it('keeps the exact personnel channel combinations', () => {
    expect(reportChannels('lzx')).toEqual(['facebook', 'tiktok']);
    expect(reportChannels('jsa')).toEqual(['facebook', 'google ads']);
    expect(reportChannels('fjx')).toEqual(['facebook', 'tiktok']);
    expect(reportChannels('')).toEqual(['facebook', 'tiktok', 'google ads']);
    expect(matchesReferenceReport({ ...row, buyer: 'jsa' }, scope)).toBe(false);
    expect(matchesReferenceReport({ ...row, buyer: 'other' }, scope)).toBe(
      false,
    );
  });
  it('combines product personnel channel and inclusive dates', () => {
    expect(matchesReferenceReport(row, scope)).toBe(true);
    for (const override of [
      { buyer: 'fjx' },
      { channel: 'facebook' },
      { platform: 'ios' },
      { end: '2026-11-10' },
      { start: '2026-11-12' },
    ])
      expect(matchesReferenceReport(row, { ...scope, ...override })).toBe(
        false,
      );
    expect(
      matchesReferenceReport(row, { ...scope, start: row.date, end: row.date }),
    ).toBe(true);
  });
  it('maps source aliases to the original FB TT Google Ads choices', () => {
    expect(reportChannel('facebook_web')).toBe('facebook');
    expect(reportChannel('GoogleAdwords_int')).toBe('google ads');
    expect(reportChannel('TikTok SAN')).toBe('tiktok');
    expect(
      matchesReferenceReport(
        { ...row, channel: 'facebook_web' },
        { ...scope, channel: 'facebook' },
      ),
    ).toBe(true);
  });
});
