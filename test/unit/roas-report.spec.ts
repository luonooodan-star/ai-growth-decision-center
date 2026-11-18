import { buildRoasReport } from '../../shared/roas-report';
const base = { app_id: 12, buyer_alias: 'lzx', media_source: 'tiktok' };
const daily = (spend: number, extra = {}) => ({
  ...base,
  report_date: '2026-11-11',
  spend,
  ...extra,
});
const cohort = (
  day: number,
  revenue: number,
  complete: unknown = true,
  extra = {},
) => ({
  ...base,
  install_date: '2026-11-11',
  cohort_index: day,
  cumulative_metric_value: revenue,
  observation_complete: complete,
  ...extra,
});
describe('ROAS install cohort report', () => {
  it('uses full delivery spend, sums partitions and preserves missing versus zero', () => {
    const [r] = buildRoasReport(
      [daily(60), daily(40)],
      [cohort(0, 10), cohort(0, 20), cohort(1, 0, false)],
    );
    expect(r.spend).toBe(100);
    expect(r.days[0]?.revenue).toBe(30);
    expect(r.days[1]).toEqual({ revenue: 0, complete: false, declining: true });
    expect(r.days[2]).toBeNull();
  });
  it('keeps buyer, platform and raw channels separate and excludes nonpositive spend', () => {
    const rows = buildRoasReport(
      [
        daily(100),
        daily(20, { media_source: 'facebook' }),
        daily(30, { media_source: 'facebook_web' }),
        daily(0, { buyer_alias: 'none' }),
        daily(50, { app_id: 3 }),
      ],
      [cohort(0, 10), cohort(0, 5, true, { app_id: 3 })],
    );
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.appId === 3)?.days[0]?.revenue).toBe(5);
    expect(rows.find((r) => r.channel === 'facebook_web')?.days[0]).toBeNull();
  });
  it('splits W2A spend and revenue using the campaign ID and preserves totals', () => {
    const fb = {
      media_source: 'facebook',
      campaign_id: '10',
      campaign_name: 'FB - app',
    };
    const web = {
      media_source: 'Facebook',
      campaign_id: '11',
      campaign_name: 'FB - W2A',
    };
    const rows = buildRoasReport(
      [daily(60, fb), daily(40, web)],
      [
        cohort(0, 12, true, fb),
        cohort(0, 8, true, { ...web, campaign_name: 'older campaign name' }),
      ],
    );
    expect(rows.find((r) => r.channel === 'facebook')).toMatchObject({
      spend: 60,
      days: [expect.objectContaining({ revenue: 12 }), ...Array(14).fill(null)],
    });
    expect(rows.find((r) => r.channel === 'facebook_web')).toMatchObject({
      spend: 40,
      days: [expect.objectContaining({ revenue: 8 }), ...Array(14).fill(null)],
    });
    expect(rows.reduce((total, row) => total + row.spend, 0)).toBe(100);
    expect(
      rows.reduce((total, row) => total + (row.days[0]?.revenue || 0), 0),
    ).toBe(20);
  });

  it('preserves attributable Facebook Web revenue when only Facebook has spend', () => {
    const rows = buildRoasReport(
      [daily(60, { media_source: 'facebook' })],
      [cohort(0, 8, true, { media_source: 'facebook', campaign_name: 'W2A' })],
    );
    const web = rows.find((r) => r.channel === 'facebook_web');
    expect(web?.spend).toBe(0);
    expect(web?.days[0]?.revenue).toBe(8);
  });

  it('retains D14, flags incomplete rows and ignores other cohort indices', () => {
    const [row] = buildRoasReport(
      [daily(100)],
      [cohort(14, 20, '0'), cohort(15, 900)],
    );
    expect(row.days).toHaveLength(15);
    expect(row.days[14]?.complete).toBe(false);
    expect(row.days[14]?.revenue).toBe(20);
  });
});
