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
                        {DETAIL_AI_JUDGMENT_LABELS[
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
                    mavisConfigured
                      ? `创建 ${mavisModel} 分析任务并记录完整过程`
                      : 'Marvis 任务桥尚未启用'
                  }
                >
                  <BrainCircuit className="size-4" />
                  {item.aiAnalysisStatus === 'running'
                    ? '分析中'
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
