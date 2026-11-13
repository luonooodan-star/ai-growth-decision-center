import { completeBiQuery } from '../../server/modules/growth-decision/paid-growth-query';
const users = Array.from({ length: 80 }, (_, i) => String(i));
const raw = users.flatMap((resolved_user_id) =>
  Array.from({ length: 30 }, (_, event) => ({
    resolved_user_id,
    event_name: `event_${event}`,
    character_id: null,
    event_count: 2,
  })),
);
function mockSource(corrupt = false) {
  let active = 0,
    max = 0;
  const query = jest.fn(async (q: Record<string, unknown>) => {
    active++;
    max = Math.max(max, active);
    await new Promise<void>((r) => setImmediate(r));
    try {
      const f = JSON.parse(String(q.filters_json || '{}'));
      if (
        f.app_id !== 12 ||
        q.start_date !== '2026-11-14' ||
        q.end_date !== '2026-11-14'
      )
        throw new Error('scope changed');
      const ids = Array.isArray(f.resolved_user_id)
        ? f.resolved_user_id
        : [f.resolved_user_id];
      const selected = raw.filter((r) => ids.includes(r.resolved_user_id));
      if (!(q.dimensions as string[]).length)
        return { rows: [{ event_count: selected.length * 2 }] };
      const rows = selected
        .slice(0, 1000)
        .map((r) => ({
          ...r,
          event_count: corrupt && ids.length < users.length ? 1 : r.event_count,
        }));
      return { rows, row_count: selected.length };
    } finally {
      active--;
    }
  });
  return { query, max: () => max };
}
const args = {
  dataset: 'bi_dwd.dwd_app_event',
  start_date: '2026-11-14',
  end_date: '2026-11-14',
  dimensions: ['resolved_user_id', 'event_name', 'character_id'],
  metrics: ['event_count'],
  filters_json: JSON.stringify({ app_id: 12, resolved_user_id: users }),
};
describe('explicit IN-filter query shards', () => {
  it('reads complete user-event results despite nullable dimensions and bounds concurrency', async () => {
    const { query, max } = mockSource();
    const rows = await completeBiQuery(query, args);
    expect(rows).toHaveLength(2400);
    expect(rows.reduce((n, r) => n + Number(r.event_count), 0)).toBe(4800);
    expect(
      new Set(rows.map((r) => `${r.resolved_user_id}:${r.event_name}`)).size,
    ).toBe(2400);
    expect(max()).toBeLessThanOrEqual(2);
    expect(
      query.mock.calls.every(
        ([q]) =>
          Object.keys(JSON.parse(String(q.filters_json)))
            .sort()
            .join(',') === 'app_id,resolved_user_id',
      ),
    ).toBe(true);
  });
  it('rejects inconsistent partial results instead of publishing them', async () => {
    const { query } = mockSource(true);
    await expect(completeBiQuery(query, args)).rejects.toThrow(
      '明细与汇总不一致',
    );
  });
  it('refuses an unsplittable capped single-user result', async () => {
    const query = async (q: Record<string, unknown>) =>
      (q.dimensions as string[]).length
        ? {
            rows: Array.from({ length: 1000 }, () => ({
              resolved_user_id: 'a',
              event_count: 1,
            })),
            truncated: true,
          }
        : { rows: [{ event_count: 2000 }] };
    await expect(
      completeBiQuery(query, {
        ...args,
        dimensions: ['resolved_user_id'],
        filters_json: JSON.stringify({ resolved_user_id: ['a'] }),
      }),
    ).rejects.toThrow('无法安全分片');
  });
});
