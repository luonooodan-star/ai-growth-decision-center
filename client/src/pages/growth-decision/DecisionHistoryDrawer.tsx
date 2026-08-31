import { useEffect, useState } from 'react';
import { Clock3, History, Loader2 } from 'lucide-react';

import type { GrowthDecisionActivity } from '@shared/api.interface';

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

const ACTION_LABELS: Record<string, string> = {
  judgment_ingested: '发现异常并生成初步判断',
  judgment_confirmed: '人工确认判断',
  judgment_deferred: '人工设为待定',
  judgment_rejected: '人工否决判断',
  recommendation_created: '生成调整建议',
  ai_analysis_completed: 'Gemini 深度分析完成',
  ai_analysis_failed: 'Gemini 手动刷新失败',
  skill_analysis_completed: '产品 Skill 降级分析完成',
  ingested: '建议进入队列',
  accepted: '采纳建议',
  rejected: '不采纳建议',
  observing: '进入观察',
  result_recorded: '记录实验结果',
};

interface DecisionHistoryDrawerProps {
  recordId: string;
  title: string;
}

const DecisionHistoryDrawer = ({
  recordId,
  title,
}: DecisionHistoryDrawerProps) => {
  const [open, setOpen] = useState<boolean>(false);
  const [items, setItems] = useState<GrowthDecisionActivity[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect((): void => {
    if (!open) return;
    setLoading(true);
    setError('');
    void growthDecision
      .getDecisionHistory(recordId)
      .then((result) => setItems(result.items))
      .catch((requestError: unknown) =>
        setError(
          requestError instanceof Error ? requestError.message : '历史加载失败',
        ),
      )
      .finally(() => setLoading(false));
  }, [open, recordId]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="size-4" />
          历史
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <div className="absolute inset-y-0 left-0 w-1 cursor-ew-resize bg-slate-200/70" />
        <SheetHeader className="px-0 pt-0">
          <SheetTitle>操作历史</SheetTitle>
          <SheetDescription>{title}</SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> 正在读取历史
          </div>
        ) : error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : items.length ? (
          <ol className="relative ml-2 border-l border-slate-200 pl-6">
            {items.map((item) => (
              <li key={item.id} className="relative pb-6">
                <span className="absolute -left-[29px] top-1 size-2.5 rounded-full bg-blue-600 ring-4 ring-white" />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {ACTION_LABELS[item.action] || item.action}
                  </Badge>
                  <span className="text-xs text-slate-500">{item.actor}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {item.detail}
                </p>
                <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
                  <Clock3 className="size-3" />
                  {new Date(item.createdAt).toLocaleString('zh-CN')}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-8 text-sm text-slate-500">暂无操作记录</p>
        )}
      </SheetContent>
    </Sheet>
  );
};

export { DecisionHistoryDrawer };
