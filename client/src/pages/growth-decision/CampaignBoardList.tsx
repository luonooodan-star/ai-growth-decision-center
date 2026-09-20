import React from 'react';
import type {
  CampaignDecisionBoard as Board,
  CampaignDecisionCard,
  CampaignDecisionPolicy,
  CampaignVerdict,
  DecideCampaignRequest,
} from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  ChevronRight,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { LABELS, COLORS, metric } from './campaign-board-display';
import {
  WORK_QUEUES,
  inWorkbench,
  type WorkbenchFilter,
} from './campaign-workbench-display';
interface Props {
  highlightedCampaignId?: string;
  board: Board | null;
  busy: boolean;
  pendingCount: number;
  analyzeVisible: () => Promise<void>;
  setRulesOpen: (v: boolean) => void;
  setPolicy: (v: CampaignDecisionPolicy | null) => void;
  load: () => Promise<void>;
  error: string;
  notice: string;
  filter: WorkbenchFilter;
  setFilter: (v: Props['filter']) => void;
  search: string;
  setSearch: (v: string) => void;
  items: CampaignDecisionCard[];
  setDetail: (v: string) => void;
  openDecision: (
    card: CampaignDecisionCard,
    type: DecideCampaignRequest['decision'],
  ) => void;
}
export const CampaignBoardList: React.FC<Props> = ({
  highlightedCampaignId,
  board,
  busy,
  pendingCount,
  analyzeVisible,
  setRulesOpen,
  setPolicy,
  load,
  error,
  notice,
  filter,
  setFilter,
  search,
  setSearch,
  items,
  setDetail,
  openDecision,
}) => (
  <Card className="border-blue-200 bg-white shadow-none">
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-xl">广告系列决策台 · 今日待办</CardTitle>
          <CardDescription className="mt-2">
            先处理影响最大的系列。看结论、确认动作、登记执行，再复查效果。
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !pendingCount}
            onClick={() => void analyzeVisible()}
          >
            <BrainCircuit className="size-4" />
            一键分析（{pendingCount}）
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setRulesOpen(true)}
          >
            <Settings2 className="size-4" />
            系列判断规则
          </Button>
          <Button
            variant="outline"
            disabled={!board || busy}
            onClick={() => setPolicy(board?.policy || null)}
          >
            <Settings2 className="size-4" />
            产品决策策略
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
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
          variant={filter === 'today' ? 'default' : 'outline'}
          onClick={() => setFilter('today')}
        >
          今日待办
        </Button>
        {(['due', 'pending'] as const).map((q) => (
          <Button
            key={q}
            size="sm"
            variant={filter === q ? 'default' : 'outline'}
            onClick={() => setFilter(q)}
          >
            {WORK_QUEUES[q]}{' '}
            {board?.items.filter((c) => c.workQueue === q).length || 0}
          </Button>
        ))}
        <Button
          size="sm"
          variant={filter === 'urgent' ? 'default' : 'outline'}
          onClick={() => setFilter('urgent')}
        >
          优先处理{' '}
          {board?.items.filter((c) => c.workQueue === 'urgent').length || 0}
        </Button>
        {(['increase', 'observe'] as CampaignVerdict[]).map((v) => (
          <Button
            size="sm"
            variant={filter === v ? 'default' : 'outline'}
            key={v}
            onClick={() => setFilter(v)}
          >
            {LABELS[v]}{' '}
            {board?.items.filter((c) => inWorkbench(c, v)).length || 0}
          </Button>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-500">
          其他分类 · 正常、数据修复与历史
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              'normal',
              'decrease',
              'adjust_ads',
              'repair',
              'inactive',
              'archive',
              'all',
            ] as const
          ).map((q) => (
            <Button
              key={q}
              size="sm"
              variant={filter === q ? 'default' : 'outline'}
              onClick={() => setFilter(q)}
            >
              {q === 'all'
                ? '全部（不含归档）'
                : q in WORK_QUEUES
                  ? WORK_QUEUES[q]
                  : LABELS[q]}{' '}
              {board?.items.filter((c) => inWorkbench(c, q)).length || 0}
            </Button>
          ))}
        </div>
      </details>
      <p className="text-xs text-slate-500">
        {board && (
          <>
            最近重新判断：{new Date(board.generatedAt).toLocaleString('zh-CN')}
            。{' '}
          </>
        )}
        判断基于最近已结束数据日，今天数据仅供观察。
      </p>
      <p className="text-xs text-slate-500">
        一键分析作用于当前列表。已排队任务不重复创建；同数据日、决策不变且指标变化均小于
        10% 时，可复用 24
        小时内结论。换日、到期、新广告或明显变化会重新分析，也可在详情手动重跑。
      </p>
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
        {board && board.items.length > 0 && !items.length && (
          <p className="rounded-lg bg-emerald-50 p-4 text-sm">
            当前分类没有待处理系列。数据修复和历史记录可在其他分类查看。
          </p>
        )}
        {items.map((card, index) => (
          <article
            key={card.key}
            className={`rounded-xl border p-4 ${highlightedCampaignId === card.snapshot.campaignId ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-slate-200'}`}
          >
            {highlightedCampaignId === card.snapshot.campaignId && (
              <p className="mb-2 font-semibold text-blue-700">
                投放数据页定位的广告系列
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={`rounded-lg px-3 py-1 text-sm font-semibold ${COLORS[card.verdict]}`}
              >
                {card.workQueue
                  ? WORK_QUEUES[card.workQueue]
                  : card.noRecentDelivery
                    ? '无新增投放'
                    : LABELS[card.verdict]}
              </span>
              {card.urgent && <Badge variant="destructive">异常优先处理</Badge>}
              {card.matchedRule && (
                <Badge variant="outline">规则：{card.matchedRule.name}</Badge>
              )}
              <span className="text-xs text-slate-500">
                {filter === 'actionable' && index < 3
                  ? `优先 ${index + 1} · `
                  : ''}
                判断数据日 {card.snapshot.dataDate}
              </span>
            </div>
            <h3 className="mt-3 break-words font-semibold text-slate-900">
              {card.snapshot.campaignName}
            </h3>
            <p className="mt-1 break-all text-xs text-slate-500">
              账户 {card.snapshot.accountId || '待确认'} · Campaign{' '}
              {card.snapshot.campaignId} · {card.snapshot.countries.join(' / ')}
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
            {card.workQueue === 'repair' && (
              <p className="mt-2 text-sm text-amber-800">
                数据待修复，不代表停止投放。请先补齐缺失数据；不会自动送入效果分析。
              </p>
            )}
            {card.previous && (
              <p className="mt-2 text-xs text-slate-500">
                较 {card.previous.dataDate}：
                {(['cpi', 'ctr', 'd0_roas', 'ecpm'] as const)
                  .map((k) => {
                    const a = card.snapshot.metrics[k],
                      b = card.previous!.metrics[k];
                    return `${k === 'ecpm' ? '买量 CPM' : k.toUpperCase()} ${a !== undefined && b !== undefined && b > 0 ? `${((a / b - 1) * 100).toFixed(1)}%` : '不可比'}`;
                  })
                  .join(' · ')}
              </p>
            )}
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
                查看
                <ChevronRight className="size-4" />
              </Button>
              {!card.blockers.length &&
                !['observe', 'normal'].includes(card.verdict) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => openDecision(card, 'accept')}
                  >
                    接受并生成执行单
                  </Button>
                )}
              {card.verdict !== 'normal' && !card.noRecentDelivery && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => openDecision(card, 'observe')}
                >
                  观察
                </Button>
              )}
              {!['normal', 'observe'].includes(card.verdict) &&
                !card.noRecentDelivery && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => openDecision(card, 'reject')}
                  >
                    不接受
                  </Button>
                )}
              <Badge variant="outline">
                {card.analysis
                  ? `${card.analysis.provider === 'codex' ? 'Codex' : '规则'}分析${card.analysisReused ? '复用（无显著变化）' : '已返回'}`
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
);
