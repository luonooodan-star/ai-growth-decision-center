import React from 'react';
import type { CampaignDecisionCard } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { BrainCircuit } from 'lucide-react';
import * as api from '@/api/campaign-decision';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { LABELS, COLORS, metric } from './campaign-board-display';
import { WORK_QUEUES } from './campaign-workbench-display';
interface Props {
  detail: string | null;
  setDetail: (value: string | null) => void;
  selected?: CampaignDecisionCard;
  busy: boolean;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
  productId: string;
  error: string;
}
export const CampaignBoardDetail: React.FC<Props> = ({
  detail,
  setDetail,
  selected,
  busy,
  run,
  productId,
  error,
}) => (
  <Sheet
    open={Boolean(detail)}
    onOpenChange={(open) => !open && setDetail(null)}
  >
    <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
      <SheetHeader>
        <SheetTitle>{selected?.snapshot.campaignName || '系列判断'}</SheetTitle>
        <SheetDescription>
          系列整体效果、趋势、广告贡献与首选行动
        </SheetDescription>
      </SheetHeader>
      {selected && (
        <div className="space-y-5 p-4">
          <p
            className={`rounded-lg p-3 font-semibold ${COLORS[selected.verdict]}`}
          >
            {selected.workQueue
              ? WORK_QUEUES[selected.workQueue]
              : LABELS[selected.verdict]}{' '}
            · {selected.reason}
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
          <h3 className="font-semibold">已返回的每日数据与趋势</h3>
          {selected.noDeliveryHideAfter && (
            <p className="text-sm text-slate-500">
              {selected.staleHistory
                ? '历史过期记录保留 7 天，'
                : '从连续第二个零消耗日结束时起保留 7 天，'}
              {new Date(selected.noDeliveryHideAfter).toLocaleString('zh-CN')}{' '}
              后隐藏；历史数据不删除。
            </p>
          )}
          {selected.noRecentDelivery && !selected.staleHistory && (
            <p className="text-sm text-slate-500">
              消耗、展示、点击与媒体安装均为零，未发现新增媒体投放。Adjust
              安装和收入仍保留，可能来自历史归因回补，不单独作为当天投放证据；不代表广告平台已暂停。未返回日期仍需核对。
            </p>
          )}
          {selected.currentDaySnapshot && (
            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
              今天 {selected.currentDaySnapshot.dataDate}{' '}
              尚未结束，仅供观察：消耗{' '}
              {metric('spend', selected.currentDaySnapshot.metrics.spend)} · CPI{' '}
              {metric('cpi', selected.currentDaySnapshot.metrics.cpi)}
              。当前判断基于 {selected.snapshot.dataDate}
              ，不将今日缺失的成熟指标视为不达标。
            </div>
          )}
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
            {new Date(selected.snapshot.fetchedAt).toLocaleString('zh-CN')}。
          </p>
          <h3 className="font-semibold">广告组与广告贡献</h3>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {selected.snapshot.breakdowns
              .filter((b) => ['adset', 'ad'].includes(b.dimension))
              .sort((a, b) => (b.metrics.spend || 0) - (a.metrics.spend || 0))
              .map((b) => (
                <div
                  key={`${b.dimension}:${b.value}`}
                  className="rounded-lg border p-3 text-xs"
                >
                  <p className="break-words font-semibold">
                    {b.dimension === 'ad' ? '广告' : '广告组'} · {b.label}
                  </p>
                  <p className="mt-1 break-all text-slate-500">ID {b.value}</p>
                  <p className="mt-1">
                    消耗 {metric('spend', b.metrics.spend)} · CTR{' '}
                    {metric('ctr', b.metrics.ctr)} · CPI{' '}
                    {metric('cpi', b.metrics.cpi)}
                  </p>
                </div>
              ))}
          </div>
          <h3 className="font-semibold">首选行动</h3>
          {selected.analysisReused && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              当前沿用本日已有分析：决策条件未变，指标变化未达到重新分析门槛。历史分析中的数值不是最新快照，请以本页趋势为准；需要重新诊断可手动重跑。
            </p>
          )}
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
              selected.noRecentDelivery ||
              selected.workQueue === 'repair' ||
              busy ||
              selected.analysisStatus === 'running'
            }
            onClick={() =>
              void run(
                () =>
                  api.analyzeCampaign(
                    productId,
                    selected.key,
                    selected.revision,
                    Boolean(selected.analysis),
                  ),
                '系列任务已提交；已有运行中的任务不会重复创建。',
              )
            }
          >
            <BrainCircuit className="size-4" />
            {selected.analysis
              ? '手动重新分析（创建新任务）'
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
);
