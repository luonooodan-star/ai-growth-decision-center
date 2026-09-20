import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  Layers3,
  RefreshCw,
  Star,
  Target,
  TrendingUp,
} from 'lucide-react';

import type {
  GrowthDashboardResponse,
  GrowthDecisionCase,
  GrowthDeliveryMetricKey,
  GrowthMonitoringSnapshot,
} from '@shared/api.interface';

import { growthDecision } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { DeleteRecordButton } from './DeleteRecordButton';
import {
  actionGroupDefinition,
  actionLabel,
  type ActionGroupDefinition,
} from './experiment-action-group';

type ReviewDimension = 'action' | 'adset';

interface ExperimentGroup {
  key: string;
  label: string;
  items: GrowthDecisionCase[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  accepted: '观察中',
  observing: '观察中',
  rejected: '未采纳',
  completed: '已结束',
};

const HISTORY_METRICS: Array<{
  key: GrowthDeliveryMetricKey;
  label: string;
}> = [
  { key: 'spend', label: '消耗' },
  { key: 'cpi', label: 'CPI' },
  { key: 'ecpm', label: 'ECPM' },
  { key: 'ctr', label: 'CTR' },
  { key: 'ipm', label: 'IPM' },
  { key: 'd0_roas', label: 'D0 ROAS' },
];

const shouldShow = (item: GrowthDecisionCase): boolean => {
  if (item.status !== 'completed') return true;
  const endedAt: string =
    item.observationEndedAt || item.completedAt || item.createdAt;
  const hideAt: number = item.hideAfterAt
    ? new Date(item.hideAfterAt).getTime()
    : new Date(endedAt).getTime() + 7 * 24 * 60 * 60 * 1000;
  return hideAt > Date.now();
};

const formatMetric = (
  key: GrowthDeliveryMetricKey,
  value: number | undefined,
): string => {
  if (value === undefined) return '—';
  if (key === 'ctr' || key === 'roas' || key === 'd0_roas') {
    return `${(value * 100).toFixed(2)}%`;
  }
  if (key === 'spend' || key === 'cpi' || key === 'ecpm') {
    return `$${value.toFixed(3)}`;
  }
  return value.toFixed(2);
};

const ExperimentLibraryPage: React.FC = () => {
  const [dashboard, setDashboard] = useState<GrowthDashboardResponse | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [dimension, setDimension] = useState<ReviewDimension>('action');
  const [selectedGroup, setSelectedGroup] = useState<ExperimentGroup | null>(
    null,
  );
  const [selectedItem, setSelectedItem] = useState<GrowthDecisionCase | null>(
    null,
  );
  const [snapshots, setSnapshots] = useState<GrowthMonitoringSnapshot[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      setDashboard(await growthDecision.getDashboard());
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : '实验库加载失败',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect((): void => {
    void load();
  }, []);

  const experiments: GrowthDecisionCase[] = useMemo(
    (): GrowthDecisionCase[] =>
      (dashboard?.cases || [])
        .filter(
          (item: GrowthDecisionCase): boolean =>
            ['accepted', 'observing', 'completed'].includes(item.status) &&
            shouldShow(item),
        )
        .sort(
          (left: GrowthDecisionCase, right: GrowthDecisionCase): number =>
            Number(Boolean(right.isFocused)) -
              Number(Boolean(left.isFocused)) ||
            new Date(right.createdAt).getTime() -
              new Date(left.createdAt).getTime(),
        ),
    [dashboard],
  );

  const groups: ExperimentGroup[] = useMemo((): ExperimentGroup[] => {
    const grouped: Map<string, ExperimentGroup> = new Map();
    for (const item of experiments) {
      const actionGroup: ActionGroupDefinition = actionGroupDefinition(item);
      const key: string =
        dimension === 'action'
          ? actionGroup.key
          : `adset:${item.adsetId || item.adsetName || item.campaignId || item.id}`;
      const label: string =
        dimension === 'action'
          ? actionGroup.label
          : item.adsetName ||
            item.adsetId ||
            item.campaignName ||
            '未定位广告组';
      const existing: ExperimentGroup | undefined = grouped.get(key);
      if (existing) existing.items.push(item);
      else grouped.set(key, { key, label, items: [item] });
    }
    return Array.from(grouped.values()).sort(
      (left: ExperimentGroup, right: ExperimentGroup): number =>
        Number(
          right.items.some((item: GrowthDecisionCase): boolean =>
            Boolean(item.isFocused),
          ),
        ) -
          Number(
            left.items.some((item: GrowthDecisionCase): boolean =>
              Boolean(item.isFocused),
            ),
          ) || right.items.length - left.items.length,
    );
  }, [dimension, experiments]);

  const completed: GrowthDecisionCase[] = experiments.filter(
    (item: GrowthDecisionCase): boolean => item.status === 'completed',
  );
  const improved: GrowthDecisionCase[] = completed.filter(
    (item: GrowthDecisionCase): boolean =>
      item.resultClassification === 'expected' ||
      item.resultClassification === 'partial',
  );

  const openItem = async (item: GrowthDecisionCase): Promise<void> => {
    setSelectedItem(item);
    setLoadingHistory(true);
    try {
      const result = await growthDecision.getMonitoringHistory(item.id);
      setSnapshots(result.items);
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-8 lg:px-8">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-blue-700">
            <Database className="size-4" /> OPERATION HISTORY
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            历史措施与结果追踪
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            按采取措施汇总成效，或按广告组回看一系列异常和行动。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <Button
              size="sm"
              variant={dimension === 'action' ? 'default' : 'ghost'}
              onClick={() => setDimension('action')}
            >
              <Layers3 className="size-4" /> 按措施
            </Button>
            <Button
              size="sm"
              variant={dimension === 'adset' ? 'default' : 'ghost'}
              onClick={() => setDimension('adset')}
            >
              <Target className="size-4" /> 按广告组
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </header>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="行动实验"
          value={experiments.length}
          icon={<Database />}
        />
        <SummaryCard
          label="已结束观测"
          value={completed.length}
          icon={<CheckCircle2 />}
        />
        <SummaryCard
          label="产生预期改善"
          value={
            completed.length
              ? `${Math.round((improved.length / completed.length) * 100)}%`
              : '—'
          }
          icon={<TrendingUp />}
        />
      </section>

      {error ? (
        <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section
        className="mt-6 grid gap-4 md:grid-cols-2"
        data-ai-section-type="card-menu"
      >
        {groups.map((group: ExperimentGroup) => {
          const activeCount: number = group.items.filter(
            (item: GrowthDecisionCase): boolean =>
              item.status === 'accepted' || item.status === 'observing',
          ).length;
          const adsetCount: number = new Set(
            group.items.map(
              (item: GrowthDecisionCase): string =>
                item.adsetId || item.adsetName || item.campaignId || item.id,
            ),
          ).size;
          return (
            <Card
              key={group.key}
              className="border-slate-200 bg-white shadow-none"
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {dimension === 'action' ? '措施组' : '广告组'}
                      </Badge>
                      {group.items.some((item: GrowthDecisionCase): boolean =>
                        Boolean(item.isFocused),
                      ) ? (
                        <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                          <Star className="size-3 fill-current" /> 重点关注
                        </Badge>
                      ) : null}
                    </div>
                    <h2 className="mt-3 text-base font-semibold text-slate-950">
                      {group.label}
                    </h2>
                    {dimension === 'adset' ? (
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        广告账户：
                        {group.items[0]?.adAccountId || '未记录'} · 广告系列：
                        {group.items[0]?.campaignName ||
                          group.items[0]?.campaignId ||
                          '未记录'}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-500">
                      {group.items.length} 次异常 · {adsetCount} 个广告组 ·{' '}
                      {activeCount} 个观察中
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedGroup(group);
                      setSelectedItem(null);
                      setSnapshots([]);
                    }}
                  >
                    查看实验 <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {!loading && !groups.length ? (
        <Card className="mt-6 border-dashed shadow-none">
          <CardHeader className="items-center py-14 text-center">
            <Clock3 className="size-6 text-slate-400" />
            <CardTitle className="text-base">还没有实验记录</CardTitle>
          </CardHeader>
        </Card>
      ) : null}

      <Sheet
        open={Boolean(selectedGroup)}
        onOpenChange={(open: boolean) => !open && setSelectedGroup(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-4xl">
          <SheetHeader>
            <SheetTitle>{selectedGroup?.label || '实验组'}</SheetTitle>
            <SheetDescription>
              {selectedItem
                ? '行动前基线和之后每小时快照'
                : '选择一条异常事件查看详细数据'}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-8">
            {selectedItem ? (
              <ExperimentHistory
                item={selectedItem}
                snapshots={snapshots}
                loading={loadingHistory}
                onDeleted={async () => {
                  setSelectedItem(null);
                  setSelectedGroup(null);
                  setSnapshots([]);
                  await load();
                }}
                onBack={() => {
                  setSelectedItem(null);
                  setSnapshots([]);
                }}
              />
            ) : (
              selectedGroup?.items.map((item: GrowthDecisionCase) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openItem(item)}
                  className="w-full rounded-xl border border-slate-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {STATUS_LABELS[item.status] || item.status}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      {item.adsetName || '未定位广告组'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-950">
                    {item.anomalyType}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    广告账户：{item.adAccountId || '未记录'} · 广告系列：
                    {item.campaignName || item.campaignId || '未记录'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.recommendation}
                  </p>
                </button>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

interface ExperimentHistoryProps {
  item: GrowthDecisionCase;
  snapshots: GrowthMonitoringSnapshot[];
  loading: boolean;
  onBack: () => void;
  onDeleted: () => void | Promise<void>;
}

const ExperimentHistory: React.FC<ExperimentHistoryProps> = ({
  item,
  snapshots,
  loading,
  onBack,
  onDeleted,
}) => (
  <>
    <div className="flex items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        返回实验组
      </Button>
      <DeleteRecordButton
        id={item.id}
        label={item.recommendation}
        onDeleted={onDeleted}
      />
    </div>
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          {STATUS_LABELS[item.status] || item.status}
        </Badge>
        {item.supersededByCaseId ? (
          <Badge variant="secondary">已由新异常措施接续</Badge>
        ) : null}
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-950">
        {item.anomalyType}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        广告账户 {item.adAccountId || '未记录'} ·{' '}
        {item.campaignName || item.campaignId || 'Campaign'} ·{' '}
        {item.adsetName || '未定位广告组'}
      </p>
      <p className="mt-3 text-sm text-slate-700">
        采取措施：{actionLabel(item)}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {item.actualResult || '仍在观察，尚未形成结论'}
      </p>
    </div>
    {loading ? (
      <p className="text-sm text-slate-500">正在读取小时快照…</p>
    ) : null}
    {snapshots.map((snapshot: GrowthMonitoringSnapshot) => (
      <article
        key={snapshot.id}
        className="rounded-xl border border-slate-200 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">
            {new Date(snapshot.observedAt).toLocaleString('zh-CN')}
          </p>
          <Badge variant={snapshot.isBaseline ? 'default' : 'outline'}>
            {snapshot.isBaseline
              ? '行动前基线'
              : snapshot.isWithinNormalRange
                ? '正常范围'
                : '异常范围'}
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {HISTORY_METRICS.map(({ key, label }) => {
            const change: number | undefined = snapshot.changesPct[key];
            return (
              <div key={key} className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {formatMetric(key, snapshot.metrics[key])}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  较上次{' '}
                  {change === undefined
                    ? '—'
                    : `${change > 0 ? '+' : ''}${change}%`}
                </p>
              </div>
            );
          })}
        </div>
      </article>
    ))}
  </>
);

interface SummaryCardProps {
  label: string;
  value: string | number;
  icon: React.ReactElement;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, icon }) => (
  <Card
    className="border-slate-200 bg-white shadow-none"
    data-ai-section-type="card-stat"
  >
    <CardContent className="flex items-center justify-between p-5">
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      </div>
      <span className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 [&>svg]:size-4">
        {icon}
      </span>
    </CardContent>
  </Card>
);

export default ExperimentLibraryPage;
