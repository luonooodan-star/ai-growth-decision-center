import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type {
  MetaAdjustmentChange,
  MetaAdjustmentJob,
  MetaAdjustmentSnapshot,
} from '@shared/api.interface';
import { validateAdjustmentChange } from '@shared/meta-adjustment';
import {
  adjustmentError,
  previewAdjustments,
  submitAdjustments,
  listAdjustments,
} from '@/api/meta-adjustments';

export type AdjustmentDrafts = Record<string, MetaAdjustmentChange>;
export const draftKey = (snapshot: MetaAdjustmentSnapshot) =>
  `${snapshot.accountId}:${snapshot.id}`;
const storageKey = 'growth-adjustment-drafts-v1';
export function useAdjustmentDrafts() {
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<AdjustmentDrafts>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(storageKey) || '{}',
      ) as AdjustmentDrafts;
      if (!saved || Array.isArray(saved) || typeof saved !== 'object')
        throw new Error();
      for (const [key, item] of Object.entries(saved))
        if (!item?.before || draftKey(item.before) !== key) throw new Error();
      setDrafts(saved);
    } catch {
      setError('本机草稿读取失败，旧草稿未载入；请重新核对后填写');
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(drafts));
    } catch {
      setError('草稿无法保存到浏览器，请勿刷新或离开本页');
    }
  }, [drafts, ready]);
  const update = (
    snapshot: MetaAdjustmentSnapshot,
    patch: Partial<MetaAdjustmentChange> | null,
  ) =>
    setDrafts((old) => {
      const next = { ...old },
        key = draftKey(snapshot);
      if (patch === null) delete next[key];
      else
        next[key] = {
          ...old[key],
          ...patch,
          before: old[key]?.before || snapshot,
        };
      return next;
    });
  return { drafts, update, error, ready };
}
export function AdjustmentRowEditor({
  snapshots,
  drafts,
  update,
}: {
  snapshots: MetaAdjustmentSnapshot[];
  drafts: AdjustmentDrafts;
  update: (
    snapshot: MetaAdjustmentSnapshot,
    patch: Partial<MetaAdjustmentChange> | null,
  ) => void;
}) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
      {snapshots.map((snapshot) => {
        const draft = drafts[draftKey(snapshot)];
        const editable = ['ACTIVE', 'PAUSED'].includes(snapshot.status);
        return (
          <div key={draftKey(snapshot)} className="space-y-2 whitespace-normal">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={!!draft}
                disabled={!editable}
                onCheckedChange={(checked) =>
                  update(snapshot, checked ? {} : null)
                }
              />
              <span>
                {snapshot.name} · ID {snapshot.id}
              </span>
            </label>
            <p className="text-slate-500">
              当前 {snapshot.status} · 实际 {snapshot.effectiveStatus} · 日预算{' '}
              {snapshot.dailyBudget && snapshot.currency === 'USD'
                ? `${Number(snapshot.dailyBudget) / 100} USD`
                : '不适用/未开放'}
            </p>
            {draft && (
              <div className="space-y-2">
                <Select
                  value={draft.status || 'unchanged'}
                  onValueChange={(value) =>
                    update(snapshot, {
                      status:
                        value === 'unchanged'
                          ? undefined
                          : (value as 'ACTIVE' | 'PAUSED'),
                    })
                  }
                >
                  <SelectTrigger aria-label={`${snapshot.name}启停`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unchanged">状态不修改</SelectItem>
                    <SelectItem value="ACTIVE">开启</SelectItem>
                    <SelectItem value="PAUSED">暂停</SelectItem>
                  </SelectContent>
                </Select>
                {snapshot.budgetEditable ? (
                  <Input
                    aria-label={`${snapshot.name}新日预算 USD`}
                    inputMode="decimal"
                    placeholder="新日预算 USD（留空不修改）"
                    value={draft.dailyBudget ?? ''}
                    onChange={(event) =>
                      update(snapshot, {
                        dailyBudget: event.target.value || undefined,
                      })
                    }
                  />
                ) : (
                  <p className="text-slate-500">{snapshot.budgetReason}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function AdjustmentSubmitPanel({
  drafts,
  update,
}: {
  drafts: AdjustmentDrafts;
  update: (
    snapshot: MetaAdjustmentSnapshot,
    patch: Partial<MetaAdjustmentChange> | null,
  ) => void;
}) {
  const [preview, setPreview] = useState<MetaAdjustmentJob | null>(null);
  const [jobs, setJobs] = useState<MetaAdjustmentJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tracking, setTracking] = useState(false);
  const changes = Object.values(drafts);
  const refresh = async () => {
    try {
      const result = await listAdjustments();
      setJobs(result);
      setTracking(result.some((job) => job.state === 'running'));
    } catch (e) {
      setError(adjustmentError(e));
      setTracking(false);
    }
  };
  useEffect(() => {
    if (!tracking) return;
    let live = true;
    const timer = window.setTimeout(() => {
      if (live) void refresh();
    }, 3000);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [tracking, jobs]);
  const prepare = async () => {
    setBusy(true);
    setError('');
    try {
      for (const change of changes) validateAdjustmentChange(change);
      setPreview(await previewAdjustments(changes));
    } catch (e) {
      setError(adjustmentError(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const job = await submitAdjustments(preview.id);
      setJobs((old) => [job, ...old.filter((j) => j.id !== job.id)]);
      // The immutable submitted task owns these changes; do not accidentally submit them again.
      for (const item of job.items) update(item.before, null);
      setTracking(job.state === 'running');
      setPreview(null);
    } catch (e) {
      setError(
        `提交响应失败，请先读取任务记录核对；同一确认清单再次提交不会重复执行。${adjustmentError(e)}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold">批量调整 · 任务进度与留档</h2>
          <p className="mt-1 text-xs text-slate-500">
            已选 {changes.length}{' '}
            项。收起层级、筛选不会清空草稿；草稿保存在本机。提交前重新校验 Meta
            原值，修改作用于整个对象，不仅是筛选的国家。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void refresh()}
          >
            读取任务记录
          </Button>
          <Button
            disabled={busy || !changes.length || tracking}
            onClick={() => void prepare()}
          >
            {busy ? '正在校验/提交' : '预检并提交'}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {changes.length > 0 && (
        <details>
          <summary>查看所有待提交项（包括已折叠或筛掉的对象）</summary>
          {changes.map((change) => (
            <div
              key={draftKey(change.before)}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm"
            >
              <span>
                {change.before.name} · {change.before.accountId} /{' '}
                {change.before.id} · {change.status || '状态不变'} ·{' '}
                {change.dailyBudget
                  ? `新日预算 ${change.dailyBudget} USD`
                  : '预算不变'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => update(change.before, null)}
              >
                移除草稿
              </Button>
            </div>
          ))}
        </details>
      )}
      {jobs.map((job) => {
        const finished = job.items.filter(
          (item) => !['pending', 'running'].includes(item.state),
        ).length;
        return (
          <div key={job.id} className="rounded-lg border p-3 text-sm">
            <p>
              {new Date(job.createdAt).toLocaleString()} · {job.state} ·{' '}
              {finished}/{job.items.length}
            </p>
            <progress
              aria-label="调整任务进度"
              className="mt-2 h-2 w-full"
              value={finished}
              max={job.items.length}
            />
            <details
              open={
                job.state === 'running' ||
                job.items.some(
                  (item) =>
                    item.state === 'failed' || item.state === 'uncertain',
                )
              }
            >
              <summary>操作明细与错误</summary>
              {job.items.map((item) => (
                <p
                  key={draftKey(item.before)}
                  className={`mt-2 ${['failed', 'uncertain'].includes(item.state) ? 'text-red-700' : ''}`}
                >
                  {item.before.name}（{item.before.id}）· {item.before.status} →{' '}
                  {item.status || '不变'} · 日预算原值{' '}
                  {item.before.dailyBudget && item.before.currency === 'USD'
                    ? Number(item.before.dailyBudget) / 100
                    : '—'}{' '}
                  → {item.dailyBudget || '不变'} {item.before.currency} ·{' '}
                  {item.state}
                  {item.error ? `：${item.error}` : ''}
                </p>
              ))}
            </details>
          </div>
        );
      })}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              确认修改 {preview?.items.length} 个 Meta 对象
            </DialogTitle>
            <DialogDescription>
              这将实际影响广告投放。开启子级不会自动开启上级。预算是账户 USD
              日预算，不是 Doris 的消耗数据。清单有效期 10 分钟。
            </DialogDescription>
          </DialogHeader>
          {preview?.items.map((item) => (
            <div
              key={draftKey(item.before)}
              className="rounded border p-3 text-sm"
            >
              <p className="font-semibold">{item.before.name}</p>
              <p>
                账户 {item.before.accountId} · {item.before.level}{' '}
                {item.before.id}
              </p>
              <p>
                状态 {item.before.status} → {item.status || '不变'}
              </p>
              <p>
                日预算{' '}
                {item.before.dailyBudget && item.before.currency === 'USD'
                  ? Number(item.before.dailyBudget) / 100
                  : '—'}{' '}
                → {item.dailyBudget || '不变'} {item.before.currency}
              </p>
            </div>
          ))}
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? '提交中' : '确认提交给 Meta API'}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
