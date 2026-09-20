import { useEffect, useState } from 'react';
import type {
  CampaignDecisionRule,
  WeeklySkillReportSummary,
} from '@shared/api.interface';
import {
  generateWeeklyReviews,
  getWeeklyReviews,
  retryWeeklyReview,
  reviewWeeklyCandidate,
} from '@/api/meta-operations';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { CampaignRulesPanel } from './CampaignRulesPanel';
const statuses = {
  pending: '等待 Codex',
  running: 'Codex 复盘中',
  completed: '待审核结论',
  failed: '复盘失败',
};

export function WeeklySkillReviews({
  onUpdated,
}: {
  onUpdated?: () => Promise<void>;
}) {
  const [reports, setReports] = useState<WeeklySkillReportSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    id: string;
    index: number;
    decision: 'approved' | 'rejected';
  } | null>(null);
  const [draft, setDraft] = useState<{
    productId: string;
    rule: CampaignDecisionRule;
  } | null>(null);
  const load = async () => setReports(await getWeeklyReviews());
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      await onUpdated?.();
    } catch {
      setError('周复盘操作失败，请检查服务连接或刷新后重试');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <section className="mt-6 space-y-4 rounded-xl border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">每周实操 → Skill 复盘</h2>
        <div className="flex gap-2">
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => void run(load)}
          >
            刷新结果
          </Button>
          <Button
            disabled={busy}
            onClick={() => void run(generateWeeklyReviews)}
          >
            汇总上周，等待 Codex 复盘
          </Button>
        </div>
      </div>
      <p className="text-sm text-slate-500">
        按上海时间上一完整自然周、产品去重；记录系统建议与人工实操差异，结合
        Doris
        结果。采纳只加入产品知识；数值规则必须另行历史试跑与发布。数据不足时不强行归纳。
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!reports.length && (
        <p className="text-sm text-slate-500">
          尚无周复盘。新增操作或人工记录后汇总；不会生成模拟结论。
        </p>
      )}
      <div className="max-h-[650px] space-y-4 overflow-y-auto">
        {reports.map((r) => (
          <article key={r.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">
                {r.evidence.product.name} · {r.weekStart}～{r.weekEnd}
              </h3>
              <Badge variant="outline">
                {r.status === 'completed' &&
                r.candidates?.length &&
                r.candidates.every((c) => c.decision)
                  ? '审核完成'
                  : statuses[r.status]}
              </Badge>
            </div>
            <p className="text-xs text-slate-500">
              操作证据 {r.evidence.coverage.returnedOperations}/
              {r.evidence.coverage.totalOperations} · 数据冻结于{' '}
              {new Date(r.createdAt).toLocaleString('zh-CN')}
              {r.evidence.coverage.truncated
                ? ' · 超出单批范围，本报告仅为部分证据，禁止全量结论'
                : ''}
            </p>
            {(r.status === 'failed' ||
              (r.status === 'running' &&
                Date.parse(r.leaseUntil || '') < Date.now())) && (
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void run(() => retryWeeklyReview(r.id))}
              >
                重试失败/超时任务
              </Button>
            )}
            {r.error && <p className="text-red-700">{r.error}</p>}
            <p className="whitespace-pre-wrap text-sm">
              {r.summary || '等待分析电脑领取并回写，不会自动改变线上规则。'}
            </p>
            {r.candidates?.map((c, index) => (
              <div
                key={index}
                className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm"
              >
                <strong>{c.title}</strong>
                <p>{c.conclusion}</p>
                <p className="text-amber-800">限制：{c.caution}</p>
                <details>
                  <summary className="cursor-pointer text-xs">
                    来源证据（{c.evidenceIds.length}）
                  </summary>
                  <p className="break-all text-xs">
                    {c.evidenceIds.join('、')}
                  </p>
                </details>
                <div className="flex flex-wrap gap-2">
                  {c.decision ? (
                    <Badge variant="outline">
                      {c.decision === 'approved'
                        ? '已采纳为产品知识'
                        : '已否决'}
                    </Badge>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({ id: r.id, index, decision: 'approved' })
                        }
                      >
                        采纳为 Skill 知识
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({ id: r.id, index, decision: 'rejected' })
                        }
                      >
                        否决
                      </Button>
                    </>
                  )}
                  {c.suggestedRule && c.decision !== 'rejected' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDraft({
                          productId: r.productId,
                          rule: c.suggestedRule!,
                        })
                      }
                    >
                      带入候选规则 → 历史试跑
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </article>
        ))}
      </div>
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认审核这条候选？</AlertDialogTitle>
            <AlertDialogDescription>
              采纳会加入产品 Skill
              知识并留存审核记录，不自动启用数值规则；否决也会留档。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm)
                  void run(() =>
                    reviewWeeklyCandidate(
                      confirm.id,
                      confirm.index,
                      confirm.decision,
                    ),
                  );
                setConfirm(null);
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {draft && (
        <CampaignRulesPanel
          open
          productId={draft.productId}
          initialRule={draft.rule}
          onClose={() => setDraft(null)}
          onSaved={load}
        />
      )}
    </section>
  );
}
