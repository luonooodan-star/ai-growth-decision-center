import React, { useEffect, useState } from 'react';
import type {
  GrowthDecisionCase,
  GrowthMonitoringSnapshot,
  UpdateResultRequest,
} from '@shared/api.interface';
import { growthDecision } from '@/api';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { DecisionHistoryDrawer } from './DecisionHistoryDrawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface CampaignExecutionHistoryProps {
  order: GrowthDecisionCase | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

export const CampaignExecutionHistory: React.FC<
  CampaignExecutionHistoryProps
> = ({ order, onClose, onChanged }) => {
  const [items, setItems] = useState<GrowthMonitoringSnapshot[]>([]);
  const [error, setError] = useState('');
  const [classification, setClassification] = useState<
    UpdateResultRequest['classification'] | ''
  >('');
  const [change, setChange] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setError('');
    setClassification('');
    setChange('');
    setNote('');
    if (order)
      void growthDecision
        .getMonitoringHistory(order.id)
        .then((result) => {
          if (!cancelled) setItems(result.items);
        })
        .catch((e: unknown) => {
          if (!cancelled)
            setError(e instanceof Error ? e.message : '历史读取失败');
        });
    return () => {
      cancelled = true;
    };
  }, [order]);
  const execution = order?.campaignExecution;
  return (
    <Sheet open={Boolean(order)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>执行前后与历史</SheetTitle>
          <SheetDescription>{order?.campaignName}</SheetDescription>
        </SheetHeader>
        {order && execution && (
          <div className="space-y-4 p-4 text-sm">
            <p>
              账户 {order.adAccountId || '未定位'} · Campaign {order.campaignId}
            </p>
            <p>
              接受／记录时间：
              {new Date(execution.acceptedAt).toLocaleString('zh-CN')}
            </p>
            <p>
              实际执行：
              {execution.executedAt
                ? new Date(execution.executedAt).toLocaleString('zh-CN')
                : '尚未登记'}
            </p>
            {execution.beforeBudget !== undefined && (
              <p>
                登记预算：${execution.beforeBudget} → ${execution.afterBudget}
                /天
              </p>
            )}
            <p>执行备注：{execution.executionNote || '—'}</p>
            <p className="rounded-lg bg-amber-50 p-3">
              基线是登记执行时最近一次抓取的快照（数据日{' '}
              {execution.baseline.dataDate}
              ），不是实时投放数值。日累计指标每小时刷新；执行同日及更早日期的数据不能作为措施生效证据。
            </p>
            <p>
              复查条件：{execution.proposal.observationHours}{' '}
              小时后检查成熟主目标、消耗和安装规模。
            </p>
            <p>回滚条件：{execution.proposal.rollbackCondition}</p>
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
            {!items.length && (
              <p className="text-slate-500">
                尚无观测快照。实际执行后随 Doris 抓取记录。
              </p>
            )}
            <div className="space-y-2">
              {items.map((s) => (
                <div className="rounded-lg border p-3" key={s.id}>
                  <p className="font-medium">
                    {s.isBaseline ? '执行前基线' : '抓取记录'} ·{' '}
                    {new Date(s.observedAt).toLocaleString('zh-CN')}
                  </p>
                  <p className="text-xs text-slate-500">
                    数据日 {s.dataDate} · 日累计
                  </p>
                  <p>
                    消耗{' '}
                    {s.metrics.spend === undefined
                      ? '—'
                      : `$${s.metrics.spend.toFixed(2)}`}{' '}
                    · CPI{' '}
                    {s.metrics.cpi === undefined
                      ? '—'
                      : `$${s.metrics.cpi.toFixed(3)}`}{' '}
                    · D0{' '}
                    {s.metrics.d0_roas === undefined
                      ? '—'
                      : `${(s.metrics.d0_roas * 100).toFixed(2)}%`}
                  </p>
                </div>
              ))}
            </div>
            <DecisionHistoryDrawer
              recordId={order.id}
              title="决策与执行操作留档"
            />
            {execution.state === 'executed' && order.status !== 'completed' && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="font-semibold">人工复查并结束实验</p>
                <p className="text-xs text-slate-500">
                  请先核对执行后的成熟数据及同期其他改动。前后改善不等于措施造成的改善，说明中请保留不确定性。
                </p>
                <select
                  className="w-full rounded-md border p-2"
                  aria-label="复查结论"
                  value={classification}
                  onChange={(e) =>
                    setClassification(
                      e.target.value as UpdateResultRequest['classification'],
                    )
                  }
                >
                  <option value="">请选择复查结论</option>
                  <option value="expected">预期改善</option>
                  <option value="partial">部分改善</option>
                  <option value="neutral">无明显改善</option>
                  <option value="negative">效果变差</option>
                </select>
                <Input
                  aria-label="主目标实际变化百分比"
                  type="number"
                  value={change}
                  onChange={(e) => setChange(e.target.value)}
                  placeholder="主目标实际变化%，例如 -10"
                />
                <Textarea
                  aria-label="实验结果说明"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="填写对照时间、数据证据和其他影响因素"
                />
                <Button
                  disabled={
                    saving ||
                    !classification ||
                    !change.trim() ||
                    !Number.isFinite(Number(change)) ||
                    !note.trim()
                  }
                  onClick={() => {
                    if (!classification) return;
                    setSaving(true);
                    setError('');
                    void growthDecision
                      .updateResult(order.id, {
                        classification,
                        actualChangePct: Number(change),
                        actualResult: note.trim(),
                      })
                      .then(async () => {
                        await onChanged();
                        onClose();
                      })
                      .catch((e: unknown) =>
                        setError(
                          e instanceof Error ? e.message : '结束实验失败',
                        ),
                      )
                      .finally(() => setSaving(false));
                  }}
                >
                  确认结果并结束（留档）
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
