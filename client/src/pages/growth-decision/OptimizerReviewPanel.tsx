import React, { useEffect, useState } from 'react';
import type {
  GrowthDecisionCase,
  OptimizerReview,
} from '@shared/api.interface';
import { approveKnowledge, getOptimizerReview } from '@/api/campaign-decision';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { actionLabel } from './experiment-action-group';
import { WeeklyReviewControls } from './WeeklyReviewControls';

export const OptimizerReviewPanel: React.FC<{
  productId: string;
  refreshedAt?: string;
}> = ({ productId, refreshedAt }) => {
  const [data, setData] = useState<OptimizerReview | null>(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<GrowthDecisionCase | null>(null);
  const [note, setNote] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    void getOptimizerReview(productId)
      .then((d) => {
        if (live) {
          setData(d);
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(e.message || '复盘加载失败');
      });
    return () => {
      live = false;
    };
  }, [productId, refreshedAt]);
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>效率与近 7 天复盘</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <WeeklyReviewControls productId={productId} />
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-emerald-700">
            {notice}
          </p>
        )}
        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ['待执行', data.pending],
                ['到期复查', data.due],
                ['数据待修复', data.repair],
                ['本周记录已完成复查', data.completedReviews],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              {data.scope} 本周采纳执行单 {data.accepted}，其中已执行{' '}
              {data.executed}；执行转化{' '}
              {data.accepted
                ? `${Math.round((data.executed / data.accepted) * 100)}%`
                : '—'}
              。首次查看 {data.opened} 个版本；已记录判断用时中位数{' '}
              {data.medianDecisionMinutes === null
                ? '—'
                : `${data.medianDecisionMinutes.toFixed(1)} 分钟`}
              （含离开页面时间）。分析提交 {data.analysisSubmitted}，去重跳过{' '}
              {data.analysisSkipped}。仅统计升级后记录，不补造旧数据。
            </p>
            <details>
              <summary className="cursor-pointer text-sm">
                复盘证据与知识库审批（{data.results.length}）
              </summary>
              <div className="mt-3 max-h-72 space-y-3 overflow-y-auto">
                {data.results.map((r) => (
                  <article key={r.id} className="rounded-lg border p-3 text-sm">
                    <p className="font-semibold">
                      {actionLabel(r)} · {r.campaignName}
                    </p>
                    <p className="text-xs text-slate-500">
                      账户 {r.adAccountId || '未定位'} · 广告组{' '}
                      {r.adsetName || '系列级措施'}
                    </p>
                    <p>{r.actualResult || '未记录结论'}</p>
                    <p>
                      分类：{r.resultClassification || '仅结束观察'} · 变化{' '}
                      {r.actualChangePct === undefined
                        ? '—'
                        : `${r.actualChangePct}%`}
                    </p>
                    {r.executedAt && r.resultClassification && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelected(r);
                          setNote(r.actualResult || '');
                        }}
                      >
                        审核为产品知识
                      </Button>
                    )}
                  </article>
                ))}
                {!data.results.length && (
                  <p className="text-sm text-slate-500">
                    本周没有已结束记录，不生成虚构复盘结论。
                  </p>
                )}
              </div>
            </details>
          </>
        )}
        <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>人工审核产品知识</DialogTitle>
              <DialogDescription>
                请核对同期改动、自然恢复、归因回补与样本。这里只沉淀有来源的证据，不直接发布规则，也不证明因果。
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="审核后的知识结论"
            />
            <Button
              disabled={busy || !note.trim()}
              onClick={() => {
                if (!selected) return;
                setBusy(true);
                void approveKnowledge(selected.id, note)
                  .then(() => {
                    setSelected(null);
                    setNotice(
                      '已留档到产品知识库；后续 AI 上下文可读取，规则仍需试跑和人工发布。',
                    );
                  })
                  .catch((e) => setError(e.message || '审核失败'))
                  .finally(() => setBusy(false));
              }}
            >
              确认结论并留档
            </Button>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};
