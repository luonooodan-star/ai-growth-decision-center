import {
  metaFailure,
  sanitizeMetaFailure,
  resolveCampaignAccounts,
} from '@shared/meta-adjustment';

describe('safe Meta diagnostics', () => {
  test.each([
    ['#190/463 token details', 'authentication', 190, 463],
    ['#200 permission details', 'permission', 200, undefined],
    ['#17 rate limit details', 'rate_limit', 17, undefined],
    ['#613 rate limit details', 'rate_limit', 613, undefined],
    ['#100 object details', 'validation', 100, undefined],
    ['Meta API 请求失败（HTTP 503）', 'upstream', undefined, undefined],
    ['fetch failed', 'network', undefined, undefined],
    ['request timeout', 'timeout', undefined, undefined],
  ])(
    'classifies %s without copying raw message',
    (text, category, code, subcode) => {
      const result = metaFailure(new Error(String(text)));
      expect(result).toMatchObject({ category, code, subcode });
      expect(result.message).not.toContain('details');
    },
  );
  test('never returns raw secrets, URLs or untrusted diagnostic messages', () => {
    const error = new Error(
      '#190/463 https://example.invalid/?access_token=fake-test-secret cookie=fake-cookie',
    );
    const safe = metaFailure(error);
    expect(JSON.stringify(safe)).not.toMatch(
      /fake-test-secret|fake-cookie|example.invalid/,
    );
    const normalized = sanitizeMetaFailure({
      ...safe,
      message: 'private secret',
      raw: error.message,
    });
    expect(JSON.stringify(normalized)).not.toMatch(
      /private secret|fake-test-secret/,
    );
    expect(sanitizeMetaFailure({ category: '__proto__' })).toBeUndefined();
    expect(metaFailure(new Error('private secret'))).toMatchObject({
      category: 'unknown',
    });
  });
  test('global Meta failure stops the queue after in-flight workers settle', async () => {
    const graph = jest.fn().mockRejectedValue(new Error('#17 throttled'));
    await expect(
      resolveCampaignAccounts(['1', '2', '3', '4', '5'], graph),
    ).rejects.toThrow('#17');
    expect(graph).toHaveBeenCalledTimes(2);
  });
});
