import { useEffect, useState } from 'react';
import { Clock3, Database, History, Play, RefreshCw } from 'lucide-react';

import type { GrowthFetchHistoryResponse, GrowthFetchRun } from '@shared/api.interface';

import { growthDecision } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const FetchHistoryControl = ({ productId, onCompleted, onError }: FetchHistoryControlProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<GrowthFetchHistoryResponse | null>(null);

  const loadHistory = async (): Promise<void> => {
    try {
      setHistory(await growthDecision.getFetchHistory(productId));
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : '抓取历史加载失败');
    }
  };

  useEffect(() => {
    if (open) void loadHistory();
  }, [open, productId]);

  const runManualFetch = async (): Promise<void> => {
    setLoading(true);
    onError('');
    try {
      await growthDecision.triggerFetch(productId);
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
      <Button variant="outline" onClick={() => void runManualFetch()} disabled={loading}>
        {loading ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
        {loading ? '正在抓取' : '立即抓取'}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline">
            <History className="size-4" />
            抓取历史
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-slate-200 px-6 py-5">
            <SheetTitle className="flex items-center gap-2">
              <Database className="size-4 text-blue-600" />
              Doris 抓取历史
            </SheetTitle>
            <SheetDescription>
              每 {history?.scheduleMinutes || 60} 分钟自动抓取，也可在产品页手动触发。
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-6 pb-8">
            {history?.items.length ? history.items.map((item) => (
              <article key={item.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{item.productName}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <Clock3 className="size-3.5" />
                      {new Date(item.startedAt).toLocaleString('zh-CN', { hour12: false })}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge variant="outline">{item.trigger === 'manual' ? '手动' : '定时'}</Badge>
                    <Badge variant={item.status === 'failed' ? 'destructive' : 'secondary'}>
                      {STATUS_LABEL[item.status]}
                    </Badge>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  <span>读取行数：{item.rowsFetched}</span>
                  <span>异常数：{item.anomalyCount}</span>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-600">{item.message}</p>
              </article>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-500">
                暂无抓取记录，点击“立即抓取”创建第一条记录。
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export { FetchHistoryControl };
