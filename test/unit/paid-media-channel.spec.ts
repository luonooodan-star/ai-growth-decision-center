import {
  classifiedMediaPart,
  paidMediaChannel,
} from '@shared/paid-media-channel';

test('W2A takes precedence within Facebook family, other sources remain unchanged', () => {
  expect(
    paidMediaChannel({ media_source: 'facebook', campaign_name: 'x_W2A_1' }),
  ).toBe('facebook_web');
  expect(
    paidMediaChannel({ media_source: 'Facebook', campaign_name: 'install' }),
  ).toBe('facebook');
  expect(
    paidMediaChannel({
      media_source: 'Facebook Web',
      campaign_name: 'install',
    }),
  ).toBe('facebook_web');
  expect(
    paidMediaChannel({ media_source: 'google', campaign_name: 'w2a' }),
  ).toBe('google');
});

test('classification does not mutate raw cache rows', () => {
  const raw = { media_source: 'facebook', campaign_name: 'W2A', spend: 12 };
  const part = { state: 'cached' as const, rows: [raw] };
  expect(classifiedMediaPart(part, 'facebook_web').rows[0].media_source).toBe(
    'facebook_web',
  );
  expect(classifiedMediaPart(part, 'facebook').rows).toEqual([]);
  expect(raw.media_source).toBe('facebook');
});
