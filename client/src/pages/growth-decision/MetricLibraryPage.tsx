import { useEffect, useMemo, useState } from 'react';
import { Calculator, Database, Gauge, RefreshCw } from 'lucide-react';

import type { GrowthDashboardResponse, GrowthMetricDefinition, GrowthProduct } from '@shared/api.interface';

import { growthDecision } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const AVAILABILITY_LABEL: Record<GrowthMetricDefinition['availability'], string> = {
  direct: 'Doris 直取',
  derived: '公式计算',
  pending: '待接入',
};

const formatValue = (metric: GrowthMetricDefinition, value?: number): string => {
  if (value === undefined) return '—';
  if (metric.unit === 'usd') return `$${value.toFixed(3)}`;
  if (metric.unit === 'percent') return `${(value * 100).toFixed(2)}%`;
  return value.toFixed(3);
};

const MetricLibraryPage = () => {
  const [dashboard, setDashboard] = useState<GrowthDashboardResponse | null>(null);
  const [productId, setProductId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void growthDecision.getDashboard().then((result) => {
      setDashboard(result);
      setProductId(result.products[0]?.id || '');
    }).finally(() => setLoading(false));
  }, []);

  const product = useMemo<GrowthProduct | undefined>(
    () => dashboard?.products.find((item) => item.id === productId),
    [dashboard, productId],
  );

  if (loading) {
    return <div className="flex min-h-[70vh] items-center justify-center gap-2 text-sm text-slate-500"><RefreshCw className="size-4 animate-spin" />正在加载指标库</div>;
  }

  return (
    <div className="mx-auto max-w-[1540px] px-5 py-8 lg:px-8">
      <section className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-blue-700"><Gauge className="size-4" />PRODUCT METRIC LIBRARY</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">产品指标库</h1>
          <p className="mt-2 text-sm text-slate-500">统一记录产品指标口径、数据来源和当前接入状态。</p>
        </div>
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger className="w-64 bg-white"><SelectValue placeholder="选择产品" /></SelectTrigger>
          <SelectContent>
            {dashboard?.products.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {product?.metrics.map((metric) => {
          const value = product.latestMetricValues?.[metric.key];
          return (
            <Card key={metric.key} className="border-slate-200 bg-white shadow-none">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div><CardTitle className="text-base">{metric.label}</CardTitle><CardDescription className="mt-1">{metric.key}</CardDescription></div>
                  <Badge variant={metric.availability === 'pending' ? 'outline' : 'secondary'}>{AVAILABILITY_LABEL[metric.availability]}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tracking-tight text-slate-950">{formatValue(metric, value)}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600">{metric.description}</p>
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
                  <p className="flex items-start gap-2"><Database className="mt-0.5 size-3.5 shrink-0" /><span>{metric.source}</span></p>
                  {metric.formula ? <p className="flex items-start gap-2"><Calculator className="mt-0.5 size-3.5 shrink-0" /><span>{metric.formula}</span></p> : null}
                  <p>期望方向：{metric.direction === 'higher' ? '越高越好' : '越低越好'}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
};

export default MetricLibraryPage;
