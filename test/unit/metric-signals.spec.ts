import {
  biMetricSignal,
  type MetricStandardProduct,
} from '@shared/metric-signals';
import { biRows } from '@shared/paid-growth';
const row = biRows([
  {
    date: '2026-09-01',
    level: 'overall',
    daily: {
      state: 'fresh',
      rows: [
        { app_id: 1, media_source: 'facebook', spend: 10, adjust_installs: 20 },
      ],
    },
    revenue: {
      state: 'fresh',
      rows: [{ app_id: 1, media_source: 'facebook', metric_value: 10 }],
    },
    events: { state: 'fresh', rows: [] },
  },
])[0];
const products: MetricStandardProduct[] = [
  {
    id: 'p',
    name: 'product',
    channel: 'FACEBOOK',
    dorisAppId: 1,
    metrics: [
      {
        key: 'd0_roas',
        label: 'D0',
        unit: 'percent',
        direction: 'higher',
        availability: 'direct',
        source: 'test',
        description: '',
        standardValue: 1,
      },
      {
        key: 'cpi',
        label: 'CPI',
        unit: 'usd',
        direction: 'lower',
        availability: 'direct',
        source: 'test',
        description: '',
        standardValue: 0.5,
      },
    ],
  },
];
describe('BI product standards', () => {
  it('100% is green, below 100% is red with ratio units converted once', () => {
    expect(biMetricSignal(row, 'd0Roas', products).state).toBe('good');
    expect(
      biMetricSignal({ ...row, d0Roas: 99.99 }, 'd0Roas', products).state,
    ).toBe('bad');
    expect(
      biMetricSignal({ ...row, d0Roas: 0 }, 'd0Roas', products).state,
    ).toBe('bad');
  });
  it('missing values, unknown channels, and ambiguous products stay neutral', () => {
    expect(
      biMetricSignal({ ...row, d0Roas: null }, 'd0Roas', products).state,
    ).toBe('unknown');
    expect(
      biMetricSignal({ ...row, media: 'organic' }, 'd0Roas', products).state,
    ).toBe('unknown');
    expect(
      biMetricSignal(row, 'd0Roas', [...products, ...products]).state,
    ).toBe('unknown');
    expect(biMetricSignal(row, 'ctr', products).state).toBe('unknown');
  });
  it('CPI direction is lower-is-better and standards changes immediately affect classification', () => {
    expect(biMetricSignal(row, 'cpi', products).state).toBe('good');
    expect(biMetricSignal({ ...row, cpi: 0.6 }, 'cpi', products).state).toBe(
      'bad',
    );
    expect(
      biMetricSignal(row, 'd0Roas', [
        {
          ...products[0],
          metrics: [{ ...products[0].metrics[0], standardValue: 1.1 }],
        },
      ]).state,
    ).toBe('bad');
  });
});
