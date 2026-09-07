import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  ChevronRight,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import type {
  CampaignDecisionBoard as Board,
  CampaignDecisionCard,
  CampaignDecisionPolicy,
  CampaignVerdict,
  DecideCampaignRequest,
  GrowthDecisionCase,
} from '@shared/api.interface';
import * as api from '@/api/campaign-decision';
import { updateDecision } from '@/api/growth-decision';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { CampaignExecutionHistory } from './CampaignExecutionHistory';

interface CampaignDecisionBoardProps {
  productId: string;
  refreshedAt?: string;
  onChanged: () => Promise<void>;
}

const LABELS: Record<CampaignVerdict, string> = {
  increase: '建议加量',
  decrease: '建议减量',
  adjust_ads: '调整广告',
  observe: '继续观察',
  normal: '正常投放',
};
const COLORS: Record<CampaignVerdict, string> = {
  increase: 'bg-emerald-50 text-emerald-700',
  decrease: 'bg-rose-50 text-rose-700',
  adjust_ads: 'bg-violet-50 text-violet-700',
  observe: 'bg-amber-50 text-amber-800',
  normal: 'bg-slate-100 text-slate-600',
};
const POLICY_LABELS: Record<keyof CampaignDecisionPolicy, string> = {
  minSpend: '单日最低消耗（美元）',
  minInstalls: '单日最低 Adjust 安装',
  consecutiveDays: '连续达标／不达标天数',
  increasePct: '单次加量幅度（%，1～30）',
  decreasePct: '单次减量幅度（%，1～50）',
  reviewHours: '执行后复查（小时，24～168）',
};
const metric = (key: string, value?: number): string => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (['d0_roas', 'roas', 'ctr'].includes(key))
    return `${(value * 100).toFixed(2)}%`;
  if (['spend', 'cpi', 'ecpm'].includes(key))
    return `$${value.toFixed(key === 'spend' ? 2 : 3)}`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
};
function errorText(error: unknown): string {
  return axios.isAxiosError(error)
    ? String(error.response?.data?.message || error.message)
    : error instanceof Error
      ? error.message
      : '操作失败';
}

export const CampaignDecisionBoard: React.FC<CampaignDecisionBoardProps> = ({
  productId,
  refreshedAt,
  onChanged,
}) => {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<CampaignVerdict | 'actionable' | 'all'>(
    'actionable',
  );
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [policy, setPolicy] = useState<CampaignDecisionPolicy | null>(null);
  const [decision, setDecision] = useState<{
    card: CampaignDecisionCard;
    type: DecideCampaignRequest['decision'];
  } | null>(null);
  const [reason, setReason] = useState('');
  const [budget, setBudget] = useState('');
  const [execution, setExecution] = useState<GrowthDecisionCase | null>(null);
  const [historyOrder, setHistoryOrder] = useState<GrowthDecisionCase | null>(
    null,
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      setBoard(await api.getCampaignBoard(productId));
      setError('');
    } catch (e: unknown) {
      setError(errorText(e));
    }
  }, [productId]);
  useEffect(() => {
    void load();
  }, [load, refreshedAt]);
  useEffect(() => {
    const timer: number = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  const run = async (
    action: () => Promise<unknown>,
    message: string,
  ): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await load();
      await onChanged();
    } catch (e: unknown) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const selected: CampaignDecisionCard | undefined = board?.items.find(
    (c) => c.key === detail,
  );
  const items: CampaignDecisionCard[] = (board?.items || []).filter(
    (c) =>
      (filter === 'all' ||
        (filter === 'actionable'
          ? c.verdict !== 'normal'
          : c.verdict === filter)) &&
      [
        c.snapshot.campaignName,
        c.snapshot.campaignId,
        c.snapshot.accountId,
        ...c.snapshot.countries,
      ]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const orders: GrowthDecisionCase[] = (board?.items || [])
    .flatMap((c) => c.recentOrders)
    .filter(
      (o) =>
        o.status !== 'completed' ||
        !o.hideAfterAt ||
        new Date(o.hideAfterAt).getTime() > Date.now(),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openDecision = (
    card: CampaignDecisionCard,
    type: DecideCampaignRequest['decision'],
  ): void => {
    setDecision({ card, type });
    setReason('');
    setBudget('');
  };
  const budgetAction: boolean = Boolean(
    decision &&
    ['increase_budget', 'decrease_budget'].includes(
      decision.card.primaryAction.actionType,
    ),
  );

  return (
    <section className="mb-6 space-y-4" data-ai-section-type="card-list">
      <Card className="border-blue-200 bg-white shadow-none">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl">广告系列决策台</CardTitle>
              <CardDescription className="mt-2">
                先处理影响最大的系列。看结论、确认动作、登记执行，再复查效果。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!board || busy}
                onClick={() => setPolicy(board?.policy || null)}
              >
                <Settings2 className="size-4" />
                产品决策策略
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void load()}
              >
                <RefreshCw className="size-4" />
                刷新
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700"
            >
              {notice}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={filter === 'actionable' ? 'default' : 'outline'}
              onClick={() => setFilter('actionable')}
            >
              优先处理
            </Button>
            {(Object.keys(LABELS) as CampaignVerdict[]).map((v) => (
              <Button
                size="sm"
                variant={filter === v ? 'default' : 'outline'}
                key={v}
                onClick={() => setFilter(v)}
              >
                {LABELS[v]}{' '}
                {board?.items.filter((c) => c.verdict === v).length || 0}
              </Button>
            ))}
            <Button
              size="sm"
              variant={filter === 'all' ? 'default' : 'outline'}
              onClick={() => setFilter('all')}
            >
              全部
            </Button>
          </div>
          <Input
            aria-label="搜索广告系列"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索系列、账户 ID 或覆盖国家"
          />
          {!board ? (
            <p className="text-sm text-slate-500">正在加载系列快照…</p>
          ) : !board.items.length ? (
            <p className="rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
              请执行一次“补齐近 7
              天数据”。本页需要完整系列快照，包含正常和异常系列。
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              共 {board.items.length} 个系列 · 当前显示 {items.length} 个 ·
              按涉及消耗与处理优先级排序 · 数据为每日累计值
            </p>
          )}
          <div className="max-h-[42rem] space-y-3 overflow-y-auto pr-1">
            {items.map((card, index) => (
              <article
                key={card.key}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`rounded-lg px-3 py-1 text-sm font-semibold ${COLORS[card.verdict]}`}
                  >
                    {LABELS[card.verdict]}
                  </span>
                  <span className="text-xs text-slate-500">
                    {filter === 'actionable' && index < 3
                      ? `优先 ${index + 1} · `
                      : ''}
                    数据日 {card.snapshot.dataDate}
                  </span>
                </div>
                <h3 className="mt-3 break-words font-semibold text-slate-900">
                  {card.snapshot.campaignName}
                </h3>
                <p className="mt-1 break-all text-xs text-slate-500">
                  账户 {card.snapshot.accountId || '待确认'} · Campaign{' '}
                  {card.snapshot.campaignId} ·{' '}
                  {card.snapshot.countries.join(' / ')}
                </p>
                <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ['spend', '消耗'],
                      ['d0_roas', '成熟 D0 ROAS'],
                      ['cpi', 'CPI'],
                      ['adjust_installs', 'Adjust 安装'],
                    ] as const
                  ).map(([key, label]) => (
                    <div className="rounded-lg bg-slate-50 p-2" key={key}>
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="font-semibold">
                        {metric(key, card.snapshot.metrics[key])}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-slate-800">{card.reason}</p>
                {card.primaryAction.changePct !== undefined && (
                  <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-blue-700">
                    {card.primaryAction.changePct > 0 ? (
                      <ArrowUpRight className="size-4" />
                    ) : (
                      <ArrowDownRight className="size-4" />
                    )}
                    实际系列日预算 {card.primaryAction.changePct > 0 ? '+' : ''}
                    {card.primaryAction.changePct}% ·{' '}
                    {card.primaryAction.observationHours} 小时复查
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setDetail(card.key)}>
                    查看判断与行动
                    <ChevronRight className="size-4" />
                  </Button>
                  {!['observe', 'normal'].includes(card.verdict) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => openDecision(card, 'accept')}
                    >
                      接受并生成执行单
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => openDecision(card, 'observe')}
                  >
                    观察
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => openDecision(card, 'reject')}
                  >
                    不接受
                  </Button>
                  <Badge variant="outline">
                    {card.analysis
                      ? `${card.analysis.provider === 'codex' ? 'Codex' : '规则'}分析已返回`
                      : card.analysisStatus === 'running'
                        ? 'Codex 排队／分析中'
                        : '产品策略初判'}
                  </Badge>
                </div>
              </article>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>执行与复查</CardTitle>
          <CardDescription>
            接受后先登记实际执行。历史指标仍按原数据日保存，执行结果从实际执行时间跟踪。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {!orders.length && (
              <p className="text-sm text-slate-500">
                暂无执行单。选择一个系列的建议后，会在这里跟踪。
              </p>
            )}
            {orders.map((order) => (
              <div key={order.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold">
                    {order.campaignName}
                  </p>
                  <Badge variant="outline">
                    {order.status === 'completed'
                      ? '已结束'
                      : order.campaignExecution?.state === 'pending'
                        ? '待执行'
                        : order.campaignExecution?.state === 'executed'
                          ? '已执行／复查中'
                          : order.campaignExecution?.state === 'rejected'
                            ? '未接受'
                            : '观察中'}
                  </Badge>
                </div>
                <p className="mt-2 text-sm">
                  {order.campaignExecution?.proposal.rationale}
                </p>
                {order.campaignExecution?.beforeBudget !== undefined && (
                  <p className="mt-1 text-sm font-medium text-blue-700">
                    日预算 ${order.campaignExecution.beforeBudget} → $
                    {order.campaignExecution.afterBudget}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {order.campaignExecution?.reviewDueAt
                    ? `复查时间 ${new Date(order.campaignExecution.reviewDueAt).toLocaleString('zh-CN')}`
                    : `创建 ${new Date(order.createdAt).toLocaleString('zh-CN')}`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {order.campaignExecution?.state === 'pending' && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setExecution(order);
                        setReason('');
                      }}
                    >
                      登记已执行
                    </Button>
                  )}
                  {order.campaignExecution?.state === 'pending' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            updateDecision(order.id, {
                              action: 'rejected',
                              reason: '人工撤回尚未执行的系列执行单',
                            }),
                          '执行单已撤回，记录保留',
                        )
                      }
                    >
                      撤回未执行单
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setHistoryOrder(order)}
                  >
                    执行前后与历史
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Sheet
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>
              {selected?.snapshot.campaignName || '系列判断'}
            </SheetTitle>
            <SheetDescription>
              系列整体效果、趋势、广告贡献与首选行动
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-5 p-4">
              <p
                className={`rounded-lg p-3 font-semibold ${COLORS[selected.verdict]}`}
              >
                {LABELS[selected.verdict]} · {selected.reason}
              </p>
              <div className="space-y-1 text-sm">
                {selected.evidence.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
              {!!selected.blockers.length && (
                <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  {selected.blockers.join('；')}
                </div>
              )}
              <h3 className="font-semibold">最近完整数据与趋势</h3>
              <div className="space-y-2">
                {selected.trend.map((day) => (
                  <div
                    key={day.dataDate}
                    className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs sm:grid-cols-5"
                  >
                    <span>{day.dataDate}</span>
                    <span>消耗 {metric('spend', day.metrics.spend)}</span>
                    <span>D0 {metric('d0_roas', day.metrics.d0_roas)}</span>
                    <span>CPI {metric('cpi', day.metrics.cpi)}</span>
                    <span>买量 CPM {metric('ecpm', day.metrics.ecpm)}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                D0 是系列成熟 cohort 回报；买量 CPM 是每千次广告展示成本。更新于{' '}
                {new Date(selected.snapshot.fetchedAt).toLocaleString('zh-CN')}
                。
              </p>
              <h3 className="font-semibold">广告组与广告贡献</h3>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {selected.snapshot.breakdowns
                  .filter((b) => ['adset', 'ad'].includes(b.dimension))
                  .sort(
                    (a, b) => (b.metrics.spend || 0) - (a.metrics.spend || 0),
                  )
                  .map((b) => (
                    <div
                      key={`${b.dimension}:${b.value}`}
                      className="rounded-lg border p-3 text-xs"
                    >
                      <p className="break-words font-semibold">
                        {b.dimension === 'ad' ? '广告' : '广告组'} · {b.label}
                      </p>
                      <p className="mt-1 break-all text-slate-500">
                        ID {b.value}
                      </p>
                      <p className="mt-1">
                        消耗 {metric('spend', b.metrics.spend)} · CTR{' '}
                        {metric('ctr', b.metrics.ctr)} · CPI{' '}
                        {metric('cpi', b.metrics.cpi)}
                      </p>
                    </div>
                  ))}
              </div>
              <h3 className="font-semibold">首选行动</h3>
              <p className="text-sm">{selected.primaryAction.rationale}</p>
              <p className="text-xs text-slate-500">
                对象：{selected.primaryAction.targetName} ·{' '}
                {selected.primaryAction.targetId}
              </p>
              {selected.primaryAction.steps.map((step, i) => (
                <p className="text-sm" key={i}>
                  {i + 1}. {step}
                </p>
              ))}
              <p className="rounded-lg bg-blue-50 p-3 text-sm">
                复查：{selected.primaryAction.observationHours} 小时 ·{' '}
                {selected.primaryAction.rollbackCondition}
              </p>
              <Button
                disabled={
                  busy ||
                  selected.analysisStatus === 'running' ||
                  Boolean(selected.analysis)
                }
                onClick={() =>
                  void run(
                    () =>
                      api.analyzeCampaign(
                        productId,
                        selected.key,
                        selected.revision,
                      ),
                    '系列综合任务已提交给 Codex，同一数据版本会复用已有分析。',
                  )
                }
              >
                <BrainCircuit className="size-4" />
                {selected.analysis
                  ? '当前数据已分析'
                  : selected.analysisStatus === 'running'
                    ? '等待 Codex 返回'
                    : 'Codex 综合分析'}
              </Button>
              {selected.analysis && (
                <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm">
                  <p className="font-semibold">{selected.analysis.summary}</p>
                  <p>{selected.analysis.primaryCause}</p>
                  {selected.analysis.evidence.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                  <p>{selected.analysis.risk}</p>
                </div>
              )}
              {selected.analysis?.adFindings?.map((finding) => (
                <div
                  key={finding.adId}
                  className="rounded-lg border border-amber-200 p-3 text-sm"
                >
                  <p className="font-semibold">
                    重点广告：{finding.adName || finding.adId}
                  </p>
                  <p>{finding.issue}</p>
                  <p>{finding.suggestedAction}</p>
                </div>
              ))}
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={Boolean(decision)}
        onOpenChange={(open) => !open && setDecision(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision?.type === 'accept'
                ? '生成待执行单'
                : decision?.type === 'reject'
                  ? '记录不接受原因'
                  : '加入观察'}
            </DialogTitle>
            <DialogDescription>
              {decision?.card.snapshot.campaignName}
            </DialogDescription>
          </DialogHeader>
          {decision?.type === 'accept' && budgetAction && (
            <div className="space-y-2">
              <p className="text-sm">
                此建议仅适用于系列日预算。请在 Facebook
                确认预算由系列控制，且本页国家覆盖该系列全部投放后，填写实际当前预算。若还有其他国家，不要执行此整系列预算单。
              </p>
              <Input
                aria-label="实际系列日预算"
                type="number"
                min="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="实际日预算（美元），不能填写消耗"
              />
              {Number(budget) > 0 && (
                <p className="text-sm text-blue-700">
                  执行单：${Number(budget).toFixed(2)} → $
                  {(
                    Number(budget) *
                    (1 + (decision.card.primaryAction.changePct || 0) / 100)
                  ).toFixed(2)}
                  /天
                </p>
              )}
            </div>
          )}
          <Textarea
            aria-label="决策原因"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="填写接受、不接受或观察的原因"
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button
            disabled={
              busy ||
              !reason.trim() ||
              (decision?.type === 'accept' &&
                budgetAction &&
                !(Number(budget) > 0))
            }
            onClick={() =>
              decision &&
              void run(async () => {
                await api.decideCampaign(productId, {
                  key: decision.card.key,
                  revision: decision.card.revision,
                  decision: decision.type,
                  reason,
                  budgetLevel: budgetAction ? 'campaign' : undefined,
                  budgetTargetId: decision.card.snapshot.campaignId,
                  beforeBudget: budgetAction ? Number(budget) : undefined,
                });
                setDecision(null);
              }, '已记录决策；待执行单需要在实际投放操作完成后登记。')
            }
          >
            确认记录
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(execution)}
        onOpenChange={(open) => !open && setExecution(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记已实际执行</DialogTitle>
            <DialogDescription>
              确认你已在 Facebook
              完成该执行单的操作。系统会保存执行时间并启动观测。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {execution?.campaignName} ·{' '}
            {execution?.campaignExecution?.proposal.rationale}
          </p>
          <Textarea
            aria-label="实际执行记录"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="记录实际改动；若与执行单不同，请写明"
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button
            disabled={busy || !reason.trim()}
            onClick={() =>
              execution &&
              void run(async () => {
                await api.executeCampaign(execution.id, reason);
                setExecution(null);
              }, '实际执行已登记，已进入实验库和每小时复查。')
            }
          >
            确认已执行
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(policy)}
        onOpenChange={(open) => !open && setPolicy(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>产品决策策略</DialogTitle>
            <DialogDescription>
              当前为试运行参数，请按产品实际规模调整。达标线继续使用指标库；预算方向与幅度由这些参数约束。
            </DialogDescription>
          </DialogHeader>
          {policy &&
            (
              Object.keys(POLICY_LABELS) as Array<keyof CampaignDecisionPolicy>
            ).map((key) => (
              <label key={key} className="space-y-1 text-sm">
                {POLICY_LABELS[key]}
                <Input
                  type="number"
                  value={policy[key]}
                  onChange={(e) =>
                    setPolicy({ ...policy, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button
            disabled={busy}
            onClick={() =>
              policy &&
              void run(async () => {
                await api.saveCampaignPolicy(productId, policy);
                setPolicy(null);
              }, '产品策略已保存，系列判断已重新计算。')
            }
          >
            保存策略
          </Button>
        </DialogContent>
      </Dialog>
      <CampaignExecutionHistory
        order={historyOrder}
        onClose={() => setHistoryOrder(null)}
        onChanged={async () => {
          await load();
          await onChanged();
        }}
      />
    </section>
  );
};
