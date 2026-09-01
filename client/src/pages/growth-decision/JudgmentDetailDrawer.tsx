import React from 'react';
import {
  Bot,
  BrainCircuit,
  Check,
  Clock3,
  SearchCheck,
  Sparkles,
  WalletCards,
  X,
} from 'lucide-react';

import type {
  GrowthActionProposal,
  GrowthDeliveryMetricKey,
  GrowthDiagnosticBreakdown,
  GrowthJudgment,
  GrowthMetricKey,
  ReviewJudgmentRequest,
} from '@shared/api.interface';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { DecisionHistoryDrawer } from './DecisionHistoryDrawer';

interface JudgmentDetailDrawerProps {
  item: GrowthJudgment | null;
  open: boolean;
  saving: boolean;
  mavisConfigured: boolean;
  mavisModel: string;
  mavisRuntimeMode: 'external_worker' | 'skill_simulation';
  onOpenChange: (open: boolean) => void;
  onAnalyze: (id: string) => Promise<void>;
  onGenerateRecommendation: (id: string) => Promise<void>;
  onReview: (
    item: GrowthJudgment,
    action: ReviewJudgmentRequest['action'],
  ) => void;
}

const DETAIL_STATUS_LABELS: Record<string, string> = {
  judgment_pending: '待判断',
  judgment_deferred: '待定',
  judgment_confirmed: '判断成立',
  judgment_rejected: '判断否决',
};

const DETAIL_AI_JUDGMENT_LABELS: Record<string, string> = {
  confirmed: 'Marvis 判断成立',
  uncertain: 'Marvis 判断待定',
  rejected: 'Marvis 判断不成立',
};

const DETAIL_METRICS: Array<{ key: GrowthMetricKey; label: string }> = [
  { key: 'cpi', label: 'CPI' },
  { key: 'cpa', label: 'CPA' },
  { key: 'd0_roas', label: 'D0 ROAS' },
  { key: 'ecpm', label: 'ECPM' },
  { key: 'retention_d1', label: '次留' },
  { key: 'ipu', label: 'IPU' },
  { key: 'arpu', label: 'ARPU' },
];

const DETAIL_DELIVERY_METRICS: Array<{
  key: GrowthDeliveryMetricKey;
  label: string;
}> = [
  { key: 'spend', label: '消耗' },
  { key: 'impressions', label: '展示' },
  { key: 'media_clicks', label: '点击' },
  { key: 'media_installs', label: '媒体安装' },
  { key: 'adjust_installs', label: 'Adjust 安装' },
  { key: 'adjust_revenue', label: 'Adjust 收入' },
  { key: 'ecpm', label: 'ECPM' },
  { key: 'ctr', label: 'CTR' },
  { key: 'ipm', label: 'IPM' },
  { key: 'cpi', label: 'CPI' },
  { key: 'roas', label: '当日 ROAS' },
  { key: 'd0_roas', label: 'D0 ROAS' },
];

const DETAIL_ACTION_LABELS: Record<
  GrowthActionProposal['actionType'],
  string
> = {
  increase_budget: '提高预算',
  decrease_budget: '降低预算',
  hold_budget: '保持预算',
  exclude_target: '排除对象',
  rotate_creative: '更换素材',
  create_experiment: '新建对照实验',
  observe: '继续观察',
  investigate_data: '补查数据',
};

const diagnosticMetricValue = (
  key: GrowthDeliveryMetricKey,
  value: number | undefined,
): string => {
  if (value === undefined) return '—';
  if (key === 'ctr' || key === 'roas' || key === 'd0_roas') {
    return `${(value * 100).toFixed(2)}%`;
  }
  if (key === 'spend' || key === 'adjust_revenue') {
    return `$${value.toFixed(2)}`;
  }
  if (key === 'cpi' || key === 'ecpm') return `$${value.toFixed(3)}`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
};

const detailMetricValue = (
  item: GrowthJudgment,
  key: GrowthMetricKey,
): string => {
  const value: number | undefined =
    item.metricValues?.[key] ??
    (item.targetMetric === key ? item.currentValue : undefined);
  if (value === undefined) return '—';
  if (key === 'd0_roas' || key === 'retention_d1') {
    return `${(value * 100).toFixed(2)}%`;
  }
  if (key === 'cpi' || key === 'cpa' || key === 'ecpm' || key === 'arpu') {
    return `$${value.toFixed(3)}`;
  }
  return value.toFixed(3);
};

const JudgmentDetailDrawer: React.FC<JudgmentDetailDrawerProps> = ({
  item,
  open,
  saving,
  mavisConfigured,
  mavisModel,
  mavisRuntimeMode,
  onOpenChange,
  onAnalyze,
  onGenerateRecommendation,
  onReview,
}) => {
  const canReview: boolean = Boolean(
    item &&
      (item.status === 'judgment_pending' ||
        item.status === 'judgment_deferred'),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-2xl xl:max-w-3xl"
      >
        <div className="absolute inset-y-0 left-0 w-1 bg-blue-600" />
        {item ? (
          <>
            <SheetHeader className="border-b border-slate-200 px-6 py-5 pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {DETAIL_STATUS_LABELS[item.status] || item.status}
                </Badge>
                <span className="text-xs text-slate-500">
                  {item.productName} · Facebook
                </span>
              </div>
              <SheetTitle className="mt-2 pr-4 text-lg leading-7">
                {item.anomalyType}
              </SheetTitle>
              <SheetDescription className="break-words leading-5">
                Campaign：{item.campaignName || item.campaignId || '产品级'}
                <br />
                广告组：{item.adsetName || item.adsetId || '未定位'}
              </SheetDescription>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <section>
                <h3 className="text-sm font-semibold text-slate-950">
                  异常概览
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {item.preliminaryJudgment}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-blue-50 px-3 py-2.5">
                    <p className="flex items-center gap-1 text-[11px] font-medium text-blue-600">
                      <WalletCards className="size-3.5" /> 消耗
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {item.spend === undefined
                        ? '—'
                        : `$${item.spend.toFixed(2)}`}
                    </p>
                  </div>
                  {DETAIL_METRICS.map(
                    (metric: { key: GrowthMetricKey; label: string }) => (
                      <div
                        key={metric.key}
                        className="rounded-lg bg-slate-50 px-3 py-2.5"
                      >
                        <p className="text-[11px] font-medium text-slate-500">
                          {metric.label}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {detailMetricValue(item, metric.key)}
                        </p>
                      </div>
                    ),
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Bot className="size-3.5" /> 判断置信度 {item.confidence}%
                  </span>
                  {item.skillRuleCandidate ? (
                    <span className="flex items-center gap-1.5">
                      <SearchCheck className="size-3.5" /> 已生成 Skill 候选规则
                    </span>
                  ) : null}
                </div>
                {DETAIL_METRICS.some(
                  (metric: { key: GrowthMetricKey; label: string }): boolean =>
                    item.metricValues?.[metric.key] === undefined &&
                    item.targetMetric !== metric.key,
                ) ? (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                    本次 Doris 未返回：
                    {DETAIL_METRICS.filter(
                      (metric: {
                        key: GrowthMetricKey;
                        label: string;
                      }): boolean =>
                        item.metricValues?.[metric.key] === undefined &&
                        item.targetMetric !== metric.key,
                    )
                      .map(
                        (metric: {
                          key: GrowthMetricKey;
                          label: string;
                        }): string => metric.label,
                      )
                      .join('、')}
                    。系统不会把缺失值当成 0；需由相应广告或产品数据源补齐。
                  </p>
                ) : null}
              </section>

              <section className="mt-6 border-t border-slate-200 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">
                    完整投放数据与历史对照
                  </h3>
                  {item.diagnosticContext ? (
                    <Badge variant="outline">
                      {item.diagnosticContext.dataDate} · 前{' '}
                      {item.diagnosticContext.comparisonDays} 个窗口
                    </Badge>
                  ) : null}
                </div>
                {item.diagnosticContext ? (
                  <>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {DETAIL_DELIVERY_METRICS.map(
                        (metric: {
                          key: GrowthDeliveryMetricKey;
                          label: string;
                        }) => {
                          const value: number | undefined =
                            item.diagnosticContext?.current[metric.key];
                          const changePct: number | undefined =
                            item.diagnosticContext?.changesPct[metric.key];
                          return (
                            <div
                              key={metric.key}
                              className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5"
                            >
                              <p className="text-[11px] font-medium text-slate-500">
                                {metric.label}
                              </p>
                              <div className="mt-1 flex items-baseline justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-900">
                                  {diagnosticMetricValue(metric.key, value)}
                                </p>
                                {changePct !== undefined ? (
                                  <span
                                    className={`text-[10px] font-medium ${
                                      changePct > 0
                                        ? 'text-red-600'
                                        : changePct < 0
                                          ? 'text-emerald-600'
                                          : 'text-slate-500'
                                    }`}
                                  >
                                    {changePct > 0 ? '+' : ''}
                                    {changePct.toFixed(1)}%
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          );
                        },
                      )}
                    </div>

                    {item.diagnosticContext.breakdowns.length ? (
                      <div className="mt-4">
                        <p className="text-xs font-medium text-slate-500">
                          当前窗口维度拆分
                        </p>
                        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                          {item.diagnosticContext.breakdowns.map(
                            (
                              breakdown: GrowthDiagnosticBreakdown,
                              index: number,
                            ) => (
                              <div
                                key={`${breakdown.dimension}-${breakdown.value}-${index}`}
                                className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-slate-800">
                                    {breakdown.label || breakdown.value}
                                  </p>
                                  <p className="text-[10px] text-slate-400">
                                    {breakdown.dimension}
                                  </p>
                                </div>
                                <span className="text-slate-600">
                                  消耗{' '}
                                  {diagnosticMetricValue(
                                    'spend',
                                    breakdown.metrics.spend,
                                  )}
                                </span>
                                <span className="text-slate-600">
                                  ECPM{' '}
                                  {diagnosticMetricValue(
                                    'ecpm',
                                    breakdown.metrics.ecpm,
                                  )}
                                </span>
                                <span className="text-slate-600">
                                  CPI{' '}
                                  {diagnosticMetricValue(
                                    'cpi',
                                    breakdown.metrics.cpi,
                                  )}
                                </span>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-lg bg-emerald-50 px-3 py-2 leading-5 text-emerald-800">
                        已获取维度：
                        {item.diagnosticContext.availableDimensions.join('、') ||
                          '暂无'}
                      </div>
                      <div className="rounded-lg bg-amber-50 px-3 py-2 leading-5 text-amber-800">
                        待补维度：
                        {item.diagnosticContext.missingDimensions.join('、') ||
                          '无'}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="mt-3 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                    这是旧异常记录，尚未保存完整投放快照。重新执行一次 Doris
                    抓取后，系统会为同一异常补齐交付指标和历史对照。
                  </p>
                )}
              </section>

              <section className="mt-6 border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-950">
                  第一波分析
                </h3>
                {item.aiAnalysisStatus === 'running' ? (
                  <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-700">
                    Marvis 正在完成第一波分析…
                  </div>
                ) : null}
                {item.aiAnalysis ? (
                  <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <BrainCircuit className="size-4 text-violet-700" />
                      <Badge
                        variant="outline"
                        className="border-violet-200 bg-white text-violet-700"
                      >
                        {item.aiAnalysis.provider === 'product_skill'
                          ? `产品 Skill ${
                              item.aiAnalysis.judgment === 'confirmed'
                                ? '判断成立'
                                : item.aiAnalysis.judgment === 'uncertain'
                                  ? '判断待定'
                                  : '判断不成立'
                            }`
                          : DETAIL_AI_JUDGMENT_LABELS[
                              item.aiAnalysis.judgment
                            ] || item.aiAnalysis.judgment}
                      </Badge>
                      <span className="text-xs text-violet-600">
                        {item.aiAnalysis.model} · 置信度{' '}
                        {item.aiAnalysis.confidence}%
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-medium leading-6 text-slate-900">
                      {item.aiAnalysis.summary}
                    </p>
                    <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="font-medium text-slate-500">首要原因</dt>
                        <dd className="mt-1 leading-5 text-slate-700">
                          {item.aiAnalysis.primaryCause}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-500">建议下一步</dt>
                        <dd className="mt-1 leading-5 text-slate-700">
                          {item.aiAnalysis.recommendedNextStep}
                        </dd>
                      </div>
                    </dl>
                    {item.aiAnalysis.evidence.length ? (
                      <div className="mt-4">
                        <p className="text-xs font-medium text-slate-500">
                          分析证据
                        </p>
                        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-700">
                          {item.aiAnalysis.evidence.map((evidence: string) => (
                            <li key={evidence}>· {evidence}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {item.aiAnalysis.recommendedActions?.length ? (
                      <div className="mt-4">
                        <p className="text-xs font-medium text-slate-500">
                          具体投放行动候选
                        </p>
                        <div className="mt-2 space-y-2">
                          {item.aiAnalysis.recommendedActions.map(
                            (actionItem: GrowthActionProposal) => (
                              <div
                                key={`${actionItem.actionType}-${actionItem.targetId}`}
                                className="rounded-lg border border-blue-200 bg-white p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge>{
                                    DETAIL_ACTION_LABELS[actionItem.actionType]
                                  }</Badge>
                                  <span className="text-xs font-medium text-slate-700">
                                    {actionItem.targetName ||
                                      actionItem.targetId}
                                  </span>
                                  {actionItem.changePct !== undefined ? (
                                    <span className="text-xs text-blue-700">
                                      {actionItem.changePct > 0 ? '+' : ''}
                                      {actionItem.changePct}%
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-2 text-xs leading-5 text-slate-700">
                                  {actionItem.rationale}
                                </p>
                                <ol className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
                                  {actionItem.steps.map(
                                    (step: string, index: number) => (
                                      <li key={step}>
                                        {index + 1}. {step}
                                      </li>
                                    ),
                                  )}
                                </ol>
                                <p className="mt-2 text-[11px] leading-5 text-amber-700">
                                  回滚：{actionItem.rollbackCondition}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    ) : null}
                    <p className="mt-4 rounded-lg bg-white/70 p-3 text-xs leading-5 text-slate-600">
                      风险：{item.aiAnalysis.risk}
                    </p>
                    {item.aiAnalysis.fallbackReason ? (
                      <p className="mt-3 text-xs leading-5 text-amber-700">
                        降级原因：{item.aiAnalysis.fallbackReason}
                      </p>
                    ) : null}
                  </div>
                ) : item.aiAnalysisStatus !== 'running' ? (
                  <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                    尚未生成第一波分析，可在下方手动运行 Marvis。
                  </p>
                ) : null}
              </section>
            </div>

            <div className="border-t border-slate-200 bg-white px-6 py-4">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <DecisionHistoryDrawer
                  recordId={item.id}
                  title={`${item.productName} · ${item.anomalyType}`}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onAnalyze(item.id)}
                  disabled={
                    saving ||
                    !mavisConfigured ||
                    item.aiAnalysisStatus === 'running'
                  }
                  title={
                    mavisRuntimeMode === 'skill_simulation'
                      ? '使用完整投放快照运行产品 Skill 深度诊断'
                      : mavisConfigured
                      ? `创建 ${mavisModel} 分析任务并记录完整过程`
                      : 'Marvis 任务桥尚未启用'
                  }
                >
                  <BrainCircuit className="size-4" />
                  {item.aiAnalysisStatus === 'running'
                    ? '分析中'
                    : mavisRuntimeMode === 'skill_simulation'
                      ? item.aiAnalysis
                        ? '重新深度诊断'
                        : '深度诊断'
                      : item.aiAnalysis?.provider === 'mavis'
                        ? '重新分析'
                        : 'Marvis 分析'}
                </Button>
                {item.status === 'judgment_confirmed' ? (
                  item.recommendationCaseId ? (
                    <Badge className="h-8 px-3" variant="secondary">
                      建议已生成
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => void onGenerateRecommendation(item.id)}
                      disabled={saving}
                    >
                      <Sparkles className="size-4" /> 生成调整建议
                    </Button>
                  )
                ) : null}
                {canReview ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReview(item, 'deferred')}
                    >
                      <Clock3 className="size-4" /> 待定
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReview(item, 'rejected')}
                    >
                      <X className="size-4" /> 否决
                    </Button>
                    <Button size="sm" onClick={() => onReview(item, 'confirmed')}>
                      <Check className="size-4" /> 确认判断
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

export { JudgmentDetailDrawer };
