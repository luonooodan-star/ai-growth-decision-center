import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, Eye, RefreshCw, Star } from 'lucide-react';

import type {
  GrowthDeliveryMetricKey,
  GrowthJudgment,
  GrowthMonitoringSnapshot,
  ReviewJudgmentRequest,
} from '@shared/api.interface';

import { growthDecision } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface ObservationQueueProps {
  judgments: GrowthJudgment[];
  saving: boolean;
  onReview: (id: string, request: ReviewJudgmentRequest) => Promise<void>;
  onToggleFocus: (id: string, focused: boolean) => Promise<void>;
}

const OBSERVATION_METRICS: Array<{
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

const ObservationQueue: React.FC<ObservationQueueProps> = ({
  judgments,
  saving,
  onReview,
  onToggleFocus,
}) => {
  const [selected, setSelected] = useState<GrowthJudgment | null>(null);
  const [snapshots, setSnapshots] = useState<GrowthMonitoringSnapshot[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  const observations: GrowthJudgment[] = useMemo(
    (): GrowthJudgment[] =>
      judgments
        .filter(
          (item: GrowthJudgment): boolean =>
            item.status === 'judgment_observing',
        )
        .sort(
          (left: GrowthJudgment, right: GrowthJudgment): number =>
            Number(Boolean(right.isFocused)) -
              Number(Boolean(left.isFocused)) ||
            new Date(right.observationStartedAt || right.createdAt).getTime() -
              new Date(left.observationStartedAt || left.createdAt).getTime(),
        ),
    [judgments],
  );

  const openHistory = async (item: GrowthJudgment): Promise<void> => {
    setSelected(item);
    setLoadingHistory(true);
    try {
      const result = await growthDecision.getMonitoringHistory(item.id);
      setSnapshots(result.items);
    } finally {
      setLoadingHistory(false);
    }
  };

  const resolveObservation = async (item: GrowthJudgment): Promise<void> => {
    await onReview(item.id, {
      action: 'resolved',
      reason: '目标指标已连续 24 小时回归产品指标库正常范围，人工确认移出观察队列。',
    });
    setSelected(null);
  };

  return (
    <>
      <Card className="border-slate-200 bg-white shadow-none">
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="size-4 text-blue-700" /> 观察队列
            </CardTitle>
            <CardDescription className="mt-1">
              每次 Doris 自动抓取都保留广告组快照，并与上一次对比
            </CardDescription>
          </div>
          <Badge variant="secondary">{observations.length} 条</Badge>
        </CardHeader>
        <CardContent>
          {observations.length ? (
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-2">
              {observations.map((item: GrowthJudgment) => (
                <article
                  key={item.id}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">观察中</Badge>
                        {item.isFocused ? (
                          <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                            <Star className="size-3 fill-current" /> 重点关注
                          </Badge>
                        ) : null}
                        {item.observationRecoveryReadyAt ? (
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                            已连续正常 24 小时
                          </Badge>
                        ) : item.observationNormalSince ? (
                          <Badge className="border-blue-200 bg-blue-50 text-blue-700">
                            正常区间验证中
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 truncate text-sm font-semibold text-slate-950">
                        {item.anomalyType}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {item.campaignName || '未指定 Campaign'} · 广告组：
                        {item.adsetName || '未定位'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={item.isFocused ? 'secondary' : 'outline'}
                        onClick={() =>
                          void onToggleFocus(item.id, !item.isFocused)
                        }
                      >
                        <Star className={`size-4 ${item.isFocused ? 'fill-current' : ''}`} />
                        {item.isFocused ? '已关注' : '重点关注'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openHistory(item)}
                      >
                        小时快照 <ChevronRight className="size-4" />
                      </Button>
                      {item.observationRecoveryReadyAt ? (
                        <Button
                          size="sm"
                          disabled={saving}
                          onClick={() => void resolveObservation(item)}
                        >
                          <Check className="size-4" /> 审核并移出
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              暂无需要等待数据回滚的异常
            </p>
          )}
        </CardContent>
      </Card>

      <Sheet open={Boolean(selected)} onOpenChange={(open: boolean) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{selected?.anomalyType || '观察历史'}</SheetTitle>
            <SheetDescription>
              {selected?.campaignName || 'Campaign'} · 广告组：
              {selected?.adsetName || '未定位'}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-8">
            {loadingHistory ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <RefreshCw className="size-4 animate-spin" /> 正在读取快照
              </p>
            ) : null}
            {snapshots.map((snapshot: GrowthMonitoringSnapshot) => (
              <article key={snapshot.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {new Date(snapshot.observedAt).toLocaleString('zh-CN')}
                  </p>
                  <Badge variant={snapshot.isWithinNormalRange ? 'secondary' : 'outline'}>
                    {snapshot.isWithinNormalRange ? '正常范围' : '仍在异常范围'}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {OBSERVATION_METRICS.map(({ key, label }) => (
                    <div key={key} className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {formatMetric(key, snapshot.metrics[key])}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        较上次 {snapshot.changesPct[key] === undefined
                          ? '—'
                          : `${snapshot.changesPct[key]! > 0 ? '+' : ''}${snapshot.changesPct[key]}%`}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
            {!loadingHistory && !snapshots.length ? (
              <p className="text-sm text-slate-500">等待下一次 Doris 抓取后生成第一条快照。</p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export { ObservationQueue };
