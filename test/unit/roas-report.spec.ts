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
