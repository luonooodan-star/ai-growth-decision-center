import type { GrowthMetricDefinition, GrowthProduct } from './api.interface';
import type { BiRow } from './paid-growth.interface';

export type MetricStandardProduct = Pick<
  GrowthProduct,
  'id' | 'name' | 'channel' | 'dorisAppId' | 'metrics'
>;
export interface MetricSignal {
  state: 'bad' | 'good' | 'unknown';
  label: string;
  standard?: number;
}
export function biMetricSignal(
  row: BiRow,
  key: keyof BiRow,
  products: MetricStandardProduct[],
): MetricSignal {
  const matches = products.filter(
    (p) =>
      p.dorisAppId === row.appId &&
      p.channel.toLowerCase() === row.media.toLowerCase(),
  );
  const metricKey = { d0Roas: 'd0_roas', cpi: 'cpi', cpm: 'ecpm' }[
    key as string
  ];
  const metric: GrowthMetricDefinition | undefined =
    matches.length === 1
      ? matches[0].metrics.find((m) => m.key === metricKey)
      : undefined;
  const value = row[key];
  if (
    !metric ||
    metric.standardValue === undefined ||
    !Number.isFinite(metric.standardValue)
  )
    return { state: 'unknown', label: '未配置唯一产品/渠道标准' };
  const standard = metric.standardValue * (metric.unit === 'percent' ? 100 : 1);
  if (typeof value !== 'number' || !Number.isFinite(value))
    return { state: 'unknown', label: '数据未返回，不作判断', standard };
  const good =
    metric.direction === 'higher' ? value >= standard : value <= standard;
  return {
    state: good ? 'good' : 'bad',
    standard,
    label: `${good ? '达标' : '未达标'} · 标准 ${metric.direction === 'higher' ? '≥' : '≤'} ${standard}${metric.unit === 'percent' ? '%' : ''}`,
  };
}
