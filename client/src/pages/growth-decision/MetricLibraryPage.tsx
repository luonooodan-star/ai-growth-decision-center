import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Gauge,
  RefreshCw,
  Save,
} from 'lucide-react';

import type {
  GrowthDashboardResponse,
  GrowthMetricDefinition,
  GrowthMetricKey,
  GrowthProduct,
  UpdateMetricStandardItem,
} from '@shared/api.interface';

import { growthDecision } from '@/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MetricDraft {
  standardValue: string;
  anomalyThreshold: string;
}

type MetricDrafts = Record<GrowthMetricKey, MetricDraft>;

const EMPTY_DRAFTS: MetricDrafts = {
  cpi: { standardValue: '', anomalyThreshold: '' },
  cpa: { standardValue: '', anomalyThreshold: '' },
  d0_roas: { standardValue: '', anomalyThreshold: '' },
  ecpm: { standardValue: '', anomalyThreshold: '' },
  retention_d1: { standardValue: '', anomalyThreshold: '' },
  ipu: { standardValue: '', anomalyThreshold: '' },
  arpu: { standardValue: '', anomalyThreshold: '' },
};

const ACTUAL_SOURCE_LABEL: Record<
  GrowthMetricDefinition['availability'],
  string
> = {
  direct: 'Doris 直取',
  derived: 'Doris 数据计算',
  pending: '实际值待接入',
};

const displayValue = (
  metric: GrowthMetricDefinition,
  value?: number,
): string => {
  if (value === undefined) return '';
  return metric.unit === 'percent'
    ? String(Number((value * 100).toFixed(4)))
    : String(value);
};

const metricUnit = (metric: GrowthMetricDefinition): string => {
  if (metric.unit === 'usd') return 'USD';
  if (metric.unit === 'percent') return '%';
  return '数值';
};

const actualValue = (
  metric: GrowthMetricDefinition,
  value?: number,
): string => {
  if (value === undefined) return '尚无抓取值';
  if (metric.unit === 'usd') return `$${value.toFixed(3)}`;
  if (metric.unit === 'percent') return `${(value * 100).toFixed(2)}%`;
  return value.toFixed(3);
};

const draftsFromProduct = (product?: GrowthProduct): MetricDrafts => {
  const result: MetricDrafts = {
    cpi: { ...EMPTY_DRAFTS.cpi },
    cpa: { ...EMPTY_DRAFTS.cpa },
    d0_roas: { ...EMPTY_DRAFTS.d0_roas },
    ecpm: { ...EMPTY_DRAFTS.ecpm },
    retention_d1: { ...EMPTY_DRAFTS.retention_d1 },
    ipu: { ...EMPTY_DRAFTS.ipu },
    arpu: { ...EMPTY_DRAFTS.arpu },
  };
  product?.metrics.forEach((metric: GrowthMetricDefinition): void => {
    result[metric.key] = {
      standardValue: displayValue(metric, metric.standardValue),
      anomalyThreshold: displayValue(metric, metric.anomalyThreshold),
    };
  });
  return result;
};

const MetricLibraryPage = () => {
  const [dashboard, setDashboard] =
    useState<GrowthDashboardResponse | null>(null);
  const [productId, setProductId] = useState<string>('');
  const [drafts, setDrafts] = useState<MetricDrafts>(EMPTY_DRAFTS);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  useEffect((): void => {
    void growthDecision
      .getDashboard()
      .then((result: GrowthDashboardResponse): void => {
        const firstProduct: GrowthProduct | undefined = result.products[0];
        setDashboard(result);
        setProductId(firstProduct?.id || '');
        setDrafts(draftsFromProduct(firstProduct));
      })
      .catch((requestError: unknown): void => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : '指标库加载失败',
        );
      })
      .finally((): void => setLoading(false));
  }, []);

  const product = useMemo<GrowthProduct | undefined>(
    (): GrowthProduct | undefined =>
      dashboard?.products.find(
        (item: GrowthProduct): boolean => item.id === productId,
      ),
    [dashboard, productId],
  );

  const changeProduct = (nextProductId: string): void => {
    const nextProduct: GrowthProduct | undefined = dashboard?.products.find(
      (item: GrowthProduct): boolean => item.id === nextProductId,
    );
    setProductId(nextProductId);
    setDrafts(draftsFromProduct(nextProduct));
    setError('');
    setSuccess('');
  };

  const changeDraft = (
    key: GrowthMetricKey,
    field: keyof MetricDraft,
    value: string,
  ): void => {
    setDrafts((current: MetricDrafts): MetricDrafts => ({
      ...current,
      [key]: { ...current[key], [field]: value },
    }));
    setSuccess('');
  };

  const parseInput = (
    metric: GrowthMetricDefinition,
    value: string,
  ): number | undefined => {
    if (!value.trim()) return undefined;
    const parsed: number = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${metric.label} 只能填写大于或等于 0 的数字`);
    }
    return metric.unit === 'percent' ? parsed / 100 : parsed;
  };

  const saveStandards = async (): Promise<void> => {
    if (!product) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const metrics: UpdateMetricStandardItem[] = product.metrics.map(
        (metric: GrowthMetricDefinition): UpdateMetricStandardItem => ({
          key: metric.key,
          standardValue: parseInput(
            metric,
            drafts[metric.key].standardValue,
          ),
          anomalyThreshold: parseInput(
            metric,
            drafts[metric.key].anomalyThreshold,
          ),
        }),
      );
      const updated: GrowthProduct =
        await growthDecision.updateMetricStandards(product.id, { metrics });
      setDashboard((current: GrowthDashboardResponse | null) =>
        current
          ? {
              ...current,
              products: current.products.map(
                (item: GrowthProduct): GrowthProduct =>
                  item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
      setDrafts(draftsFromProduct(updated));
      setSuccess(
        '指标标准已保存，下一次 Doris 抓取会按异常阈值自动比对。',
      );
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '指标标准保存失败',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center gap-2 text-sm text-slate-500">
        <RefreshCw className="size-4 animate-spin" />
        正在加载指标库
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1540px] px-5 py-8 lg:px-8">
      <section className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-blue-700">
            <Gauge className="size-4" /> PRODUCT METRIC LIBRARY
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            产品指标标准库
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            人工录入产品标准值和异常阈值。Doris 每次抓取后按 Campaign、广告组实际值交叉比对，越过阈值的记录进入产品异常队列。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={productId} onValueChange={changeProduct}>
            <SelectTrigger className="w-64 bg-white">
              <SelectValue placeholder="选择产品" />
            </SelectTrigger>
            <SelectContent>
              {dashboard?.products.map((item: GrowthProduct) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => void saveStandards()}
            disabled={saving || !product}
          >
            {saving ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存标准
          </Button>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive" className="mt-5">
          <AlertCircle className="size-4" />
          <AlertTitle>保存未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="success" className="mt-5">
          <CheckCircle2 className="size-4" />
          <AlertTitle>保存成功</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {product?.metrics.map((metric: GrowthMetricDefinition) => {
          const draft: MetricDraft = drafts[metric.key];
          const thresholdRule: string =
            metric.direction === 'lower'
              ? '实际值高于阈值时判为异常'
              : '实际值低于阈值时判为异常';
          return (
            <Card
              key={metric.key}
              className="border-slate-200 bg-white shadow-none"
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{metric.label}</CardTitle>
                    <CardDescription className="mt-1">
                      {metric.description}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      metric.availability === 'pending'
                        ? 'outline'
                        : 'secondary'
                    }
                  >
                    {ACTUAL_SOURCE_LABEL[metric.availability]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-slate-600">
                    标准值（{metricUnit(metric)}）
                    <Input
                      className="mt-2"
                      type="number"
                      min="0"
                      step="any"
                      value={draft.standardValue}
                      onChange={(event) =>
                        changeDraft(
                          metric.key,
                          'standardValue',
                          event.target.value,
                        )
                      }
                      placeholder="手动录入"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    异常阈值（{metricUnit(metric)}）
                    <Input
                      className="mt-2"
                      type="number"
                      min="0"
                      step="any"
                      value={draft.anomalyThreshold}
                      onChange={(event) =>
                        changeDraft(
                          metric.key,
                          'anomalyThreshold',
                          event.target.value,
                        )
                      }
                      placeholder="留空不检测"
                    />
                  </label>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                  <p>{thresholdRule}</p>
                  <p className="mt-1">
                    最新实际值：
                    {actualValue(
                      metric,
                      product.latestMetricValues?.[metric.key],
                    )}
                  </p>
                </div>
                <p className="flex items-start gap-2 text-xs text-slate-500">
                  <Database className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {metric.source}
                    {metric.formula ? ` · ${metric.formula}` : ''}
                  </span>
                </p>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
};

export default MetricLibraryPage;
