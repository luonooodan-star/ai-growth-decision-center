import { useEffect, useState } from 'react';
import {
  CalendarRange,
  Clock3,
  Database,
  History,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import type {
  GrowthDataHistoryResponse,
  GrowthDataSnapshot,
  GrowthFetchHistoryResponse,
  GrowthFetchRun,
  GrowthHistoryResetResult,
} from '@shared/api.interface';

import { growthDecision } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

const STATUS_LABEL: Record<GrowthFetchRun['status'], string> = {
  running: '抓取中',
  success: '成功',
  partial: '部分完成',
  failed: '失败',
};

interface FetchHistoryControlProps {
  productId: string;
  onCompleted: () => Promise<void>;
  onError: (message: string) => void;
}

const FetchHistoryControl = ({
  productId,
  onCompleted,
  onError,
}: FetchHistoryControlProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [history, setHistory] = useState<GrowthFetchHistoryResponse | null>(
    null,
  );
  const [dataHistory, setDataHistory] =
    useState<GrowthDataHistoryResponse | null>(null);
  const [resultMessage, setResultMessage] = useState<string>('');

  const loadHistory = async (): Promise<void> => {
    try {
      const [fetchResponse, dataResponse]: [
        GrowthFetchHistoryResponse,
        GrowthDataHistoryResponse,
      ] = await Promise.all([
        growthDecision.getFetchHistory(productId),
        growthDecision.getDataHistory(productId),
      ]);
      setHistory(fetchResponse);
      setDataHistory(dataResponse);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : '抓取历史加载失败');
    }
  };

  const runHistoryBackfill = async (
    historyDays: 7 | 14 | 30,
  ): Promise<void> => {
    setLoading(true);
    setResultMessage('');
    onError('');
    try {
      setOpen(true);
      const runs = await growthDecision.backfillHistory(productId, historyDays);
      await Promise.all([loadHistory(), onCompleted()]);
      setResultMessage(runs.map((run) => run.message).join('；'));
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : '历史数据补抓失败');
    } finally {
      setLoading(false);
    }
  };

  const resetAllHistory = async (): Promise<void> => {
    setResetting(true);
    setResultMessage('');
    onError('');
    try {
      const result: GrowthHistoryResetResult =
        await growthDecision.resetHistory();
      await Promise.all([loadHistory(), onCompleted()]);
      setResultMessage(
        `历史已清空：${result.deleted.fetchRuns} 次抓取、` +
          `${result.deleted.snapshots} 天快照、` +
          `${result.deleted.decisionRecords} 条判断/实验。产品与指标标准已保留。`,
      );
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : '历史数据清空失败');
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    if (!open && !loading) return;
    let stopped = false;
    let timer: number;
    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) await loadHistory();
      if (!stopped) timer = window.setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [open, loading, productId]);

  const runManualFetch = async (resumeMissing = false): Promise<void> => {
    setLoading(true);
    onError('');
    try {
      setOpen(true);
      const runs = await growthDecision.triggerFetch(productId, resumeMissing);
      setResultMessage(runs.map((run) => run.message).join('；'));
      await Promise.all([loadHistory(), onCompleted()]);
      setOpen(true);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : '手动抓取失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => void runManualFetch()}
        disabled={loading}
      >
        {loading ? (
          <RefreshCw className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        {loading ? '正在抓取' : '立即抓取'}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline">
            <History className="size-4" />
            抓取历史
          </Button>
        </SheetTrigger>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto p-0 sm:max-w-xl"
        >
          <SheetHeader className="border-b border-slate-200 px-6 py-5">
            <SheetTitle className="flex items-center gap-2">
              <Database className="size-4 text-blue-600" />
              Doris 抓取历史
            </SheetTitle>
            <SheetDescription>
              每 {history?.scheduleMinutes || 60}{' '}
              分钟自动抓取，也可在产品页手动触发。
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-6 pb-8 pt-5">
            <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CalendarRange className="size-4 text-blue-600" />
                补历史数据
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                自动分片取数并核对汇总，通过校验后更新快照；失败保留旧数据。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={loading || resetting}
                  onClick={() => void runManualFetch(true)}
                >
                  补齐缺失数据
                </Button>
                {([7, 14, 30] as const).map((days: 7 | 14 | 30) => (
                  <Button
                    key={days}
                    size="sm"
                    variant="outline"
                    disabled={loading || resetting}
                    onClick={() => void runHistoryBackfill(days)}
                  >
                    补最近 {days} 天
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                补齐会续用有效分片并重新核对汇总。需要全量重查时，选择“补最近 N
                天”。
              </p>
            </section>

            {resultMessage ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700">
                {resultMessage}
              </p>
            ) : null}

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    每日数据快照
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    共 {dataHistory?.items.length || 0} 天
                  </p>
                </div>
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {dataHistory?.items.length ? (
                  dataHistory.items.map((item: GrowthDataSnapshot) => (
                    <article
                      key={item.id}
                      className="rounded-xl border border-slate-200 bg-white p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {item.dataDate}
                        </p>
                        <span className="text-[11px] text-slate-400">
                          {item.sourceRows} 行
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
                        <span>消耗 ${formatMetric(item.metrics.spend)}</span>
                        <span>CPI ${formatMetric(item.metrics.cpi)}</span>
                        <span>ECPM ${formatMetric(item.metrics.ecpm)}</span>
                        <span>
                          D0 ROAS {formatPercent(item.metrics.d0_roas)}
                        </span>
                        <span>Campaign {item.campaignCount}</span>
                        <span>广告组 {item.adsetCount}</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-500">
                    暂无每日快照，可先补抓最近 7、14 或 30 天。
                  </div>
                )}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">
                抓取任务记录
              </h3>
              {history?.items.length ? (
                history.items.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {item.productName}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                          <Clock3 className="size-3.5" />
                          {new Date(item.startedAt).toLocaleString('zh-CN', {
                            hour12: false,
                          })}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <Badge variant="outline">
                          {item.trigger === 'manual' ? '手动' : '定时'}
                        </Badge>
                        <Badge
                          variant={
                            item.status === 'failed'
                              ? 'destructive'
                              : 'secondary'
                          }
                        >
                          {STATUS_LABEL[item.status]}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                      <span>读取行数：{item.rowsFetched}</span>
                      <span>异常数：{item.anomalyCount}</span>
                    </div>
                    {item.startDate && (
                      <p className="mt-2 text-xs text-slate-500">
                        范围：{item.startDate} ～ {item.endDate}
                      </p>
                    )}
                    {item.progress && (
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        <p>
                          {item.phase === 'validating'
                            ? '校验中'
                            : item.phase === 'repairing'
                              ? '补齐中'
                              : STATUS_LABEL[item.status]}{' '}
                          · 完成步骤 {item.progress.completed} · 复用分片{' '}
                          {item.progress.reused} · 缺口 {item.progress.failed}
                        </p>
                        <p className="break-words">{item.progress.current}</p>
                      </div>
                    )}
                    <p className="mt-3 text-xs leading-5 text-slate-600">
                      {item.message}
                    </p>
                    {!!item.gaps?.length && (
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-lg bg-amber-50 p-2">
                        {item.gaps.map((gap, index) => (
                          <p
                            key={index}
                            className="break-words text-xs text-amber-900"
                          >
                            {gap.dataDate} · {gap.dataset.split('.').pop()}：
                            {gap.message}
                          </p>
                        ))}
                      </div>
                    )}
                  </article>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-500">
                  暂无抓取记录，点击“立即抓取”创建第一条记录。
                </div>
              )}
            </section>

            <section className="rounded-xl border border-red-200 bg-red-50/60 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-red-800">重新开始</p>
                  <p className="mt-1 text-xs leading-5 text-red-700">
                    清空抓取、快照、异常、Codex、建议及实验结果；保留产品和指标库标准。
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={loading || resetting}
                    >
                      <Trash2 className="size-4" />
                      清空历史
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        确认清空全部运行历史？
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作不可撤销。产品、Doris
                        配置和指标库标准会保留，所有抓取、判断、分析、建议及实验记录会被删除。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-600 text-white hover:bg-red-700"
                        onClick={() => void resetAllHistory()}
                      >
                        确认清空
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

const formatMetric = (value?: number): string =>
  value === undefined ? '—' : value.toFixed(2);

const formatPercent = (value?: number): string =>
  value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;

export { FetchHistoryControl };
