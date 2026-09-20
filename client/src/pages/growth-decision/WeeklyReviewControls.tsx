import React, { useEffect, useState } from 'react';
import type { OptimizerWeeklyState } from '@shared/api.interface';
import { weeklyReview } from '@/api/campaign-decision';
import { Button } from '@/components/ui/button';

export const WeeklyReviewControls: React.FC<{ productId: string }> = ({
  productId,
}) => {
  const [state, setState] = useState<OptimizerWeeklyState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setState(null);
    void weeklyReview(productId, 'read')
      .then((s) => {
        if (live) setState(s);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [productId]);
  const run = async (action: 'generate' | 'configure') => {
    setBusy(true);
    setError('');
    try {
      setState(await weeklyReview(productId, action, !state?.enabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !state}
          onClick={() => void run('configure')}
        >
          {state?.enabled ? '暂停自动周复盘' : '启用每周复盘'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !state}
          onClick={() => void run('generate')}
        >
          生成本期复盘（去重）
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        周一 10:00（上海时区），服务每 30
        分钟检查；错过后补生成。结果仅留在本系统，不自动发消息或修改规则。
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">
          已留档复盘（{state?.reports.length || 0}）
        </summary>
        <div className="max-h-60 space-y-2 overflow-y-auto">
          {state?.reports.map((r) => (
            <article key={r.id} className="rounded-lg border p-3 text-sm">
              <p className="font-semibold">复盘周 {r.week}</p>
              <p>{r.summary}</p>
              <p className="text-xs text-slate-500">
                实际生成 {new Date(r.createdAt).toLocaleString('zh-CN')}
              </p>
            </article>
          ))}
        </div>
      </details>
    </div>
  );
};
