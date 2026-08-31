import React, { useMemo, useState } from 'react';
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

import { DecisionHistoryDrawer } from './DecisionHistoryDrawer';

interface JudgmentQueueProps {
  judgments: GrowthJudgment[];
  saving: boolean;
  onReview: (
    id: string,
    request: ReviewJudgmentRequest,
  ) => Promise<void>;
  onGenerateRecommendation: (id: string) => Promise<void>;
  onAnalyze: (id: string) => Promise<void>;
  aiConfigured: boolean;
  aiModel: string;
}

const STATUS_LABELS: Record<string, string> = {
  judgment_pending: '待判断',
  judgment_deferred: '待定',
  judgment_confirmed: '判断成立',
  judgment_rejected: '判断否决',
};

const ACTION_LABELS: Record<ReviewJudgmentRequest['action'], string> = {
  confirmed: '确认判断',
  deferred: '暂时待定',
  rejected: '否决判断',
};

const AI_JUDGMENT_LABELS: Record<string, string> = {
  confirmed: 'AI 判断成立',
  uncertain: 'AI 判断待定',
  rejected: 'AI 判断不成立',
};

const DEFAULT_METRICS: Array<{ key: GrowthMetricKey; label: string }> = [
  { key: 'cpi', label: 'CPI' },
  { key: 'cpa', label: 'CPA' },
  { key: 'd0_roas', label: 'D0 ROAS' },
  { key: 'ecpm', label: 'ECPM' },
  { key: 'retention_d1', label: '次留' },
  { key: 'ipu', label: 'IPU' },
  { key: 'arpu', label: 'ARPU' },
];

const metricValue = (item: GrowthJudgment, key: GrowthMetricKey): string => {
  const value = item.metricValues?.[key] ?? (item.targetMetric === key ? item.currentValue : undefined);
  if (value === undefined) return '—';
  if (key === 'd0_roas' || key === 'retention_d1') return `${(value * 100).toFixed(2)}%`;
  if (key === 'cpi' || key === 'cpa' || key === 'ecpm' || key === 'arpu') return `$${value.toFixed(3)}`;
  return value.toFixed(3);
};

const JudgmentQueue: React.FC<JudgmentQueueProps> = ({
  judgments,
  saving,
  onReview,
  onGenerateRecommendation,
  onAnalyze,
  aiConfigured,
  aiModel,
}) => {
  const [selected, setSelected] = useState<GrowthJudgment | null>(null);
  const [reviewAction, setReviewAction] =
    useState<ReviewJudgmentRequest['action'] | null>(null);
  const [reason, setReason] = useState<string>('');
  const [ruleCandidate, setRuleCandidate] = useState<string>('');

  const orderedJudgments: GrowthJudgment[] = useMemo(
    (): GrowthJudgment[] =>
      [...judgments].sort((left: GrowthJudgment, right: GrowthJudgment) => {
        const leftOpen: boolean =
          left.status === 'judgment_pending' ||
          left.status === 'judgment_deferred';
        const rightOpen: boolean =
          right.status === 'judgment_pending' ||
          right.status === 'judgment_deferred';
        return Number(rightOpen) - Number(leftOpen);
      }),
    [judgments],
  );

  const openReview = (
    item: GrowthJudgment,
    action: ReviewJudgmentRequest['action'],
  ): void => {
    setSelected(item);
    setReviewAction(action);
    setReason('');
    setRuleCandidate(item.skillRuleCandidate || '');
  };

  const closeReview = (): void => {
    setSelected(null);
    setReviewAction(null);
    setReason('');
    setRuleCandidate('');
  };

  const submitReview = async (): Promise<void> => {
    if (!selected || !reviewAction || !reason.trim()) {
      return;
    }
    await onReview(selected.id, {
      action: reviewAction,
      reason: reason.trim(),
      skillRuleCandidate: ruleCandidate.trim() || undefined,
    });
    closeReview();
  };

  return (
    <>
      <Card className="border-slate-200 bg-white shadow-none">
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">异常判断队列</CardTitle>
            <CardDescription className="mt-1">
              先确认异常与原因是否成立，再进入调整建议阶段
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={aiConfigured ? 'secondary' : 'outline'}>
              Groq 120B {aiConfigured ? '已连接' : '待配置'}
            </Badge>
            <Badge variant="secondary">{judgments.length} 条</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {orderedJudgments.length ? (
            <div className="space-y-3" data-ai-section-type="card-list">
              {orderedJudgments.map((item: GrowthJudgment) => {
                const canReview: boolean =
                  item.status === 'judgment_pending' ||
                  item.status === 'judgment_deferred';
                return (
                  <article
                    key={item.id}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-col justify-between gap-4 lg:flex-row">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {STATUS_LABELS[item.status] || item.status}
                          </Badge>
                          <span className="text-xs text-slate-500">
                            {item.productName}
                          </span>
                          <span className="truncate text-xs text-slate-500">Campaign：{item.campaignName || item.campaignId || '产品级'}</span>
                          <span className="truncate text-xs text-slate-500">广告组：{item.adsetName || item.adsetId || '未定位'}</span>
                        </div>
                        <h2 className="mt-3 text-sm font-semibold text-slate-950">
                          {item.anomalyType} · {item.targetMetric.toUpperCase()}
                          {typeof item.deviationPct === 'number'
                            ? ` ${item.deviationPct > 0 ? '+' : ''}${item.deviationPct}%`
                            : ''}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {item.preliminaryJudgment}
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                          <div className="rounded-lg bg-blue-50 px-2.5 py-2">
                            <p className="flex items-center gap-1 text-[10px] font-medium text-blue-600">
                              <WalletCards className="size-3" /> 消耗
                            </p>
                            <p className="mt-1 text-xs font-semibold text-slate-900">
                              {item.spend === undefined ? '—' : `$${item.spend.toFixed(2)}`}
                            </p>
                          </div>
                          {DEFAULT_METRICS.map((metric) => (
                            <div key={metric.key} className="rounded-lg bg-slate-50 px-2.5 py-2">
                              <p className="text-[10px] font-medium text-slate-500">{metric.label}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-900">{metricValue(item, metric.key)}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <Bot className="size-3.5" />
                            判断置信度 {item.confidence}%
                          </span>
                          {item.skillRuleCandidate ? (
                            <span className="flex items-center gap-1.5">
                              <SearchCheck className="size-3.5" />
                              已生成 Skill 候选规则
                            </span>
                          ) : null}
                        </div>
                        {item.aiAnalysis ? (
                          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <BrainCircuit className="size-4 text-violet-700" />
                              <Badge variant="outline" className="border-violet-200 bg-white text-violet-700">
                                {AI_JUDGMENT_LABELS[item.aiAnalysis.judgment]}
                              </Badge>
                              <span className="text-xs text-violet-600">
                                {item.aiAnalysis.model} · 置信度 {item.aiAnalysis.confidence}%
                              </span>
                            </div>
                            <p className="mt-3 text-sm font-medium leading-6 text-slate-900">
                              {item.aiAnalysis.summary}
                            </p>
                            <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                              <div>
                                <dt className="font-medium text-slate-500">首要原因</dt>
                                <dd className="mt-1 leading-5 text-slate-700">{item.aiAnalysis.primaryCause}</dd>
                              </div>
                              <div>
                                <dt className="font-medium text-slate-500">建议下一步</dt>
                                <dd className="mt-1 leading-5 text-slate-700">{item.aiAnalysis.recommendedNextStep}</dd>
                              </div>
                            </dl>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <DecisionHistoryDrawer
                          recordId={item.id}
                          title={`${item.productName} · ${item.anomalyType}`}
                        />
                        {canReview ? (
                          <Button
                            variant="outline"
                            onClick={() => void onAnalyze(item.id)}
                            disabled={saving || !aiConfigured}
                            title={
                              aiConfigured
                                ? `使用 ${aiModel} 分析`
                                : '请先在公司 Mac 配置 Groq API Key'
                            }
                          >
                            <BrainCircuit className="size-4" />
                            {item.aiAnalysis ? '重新深度分析' : 'AI 深度分析'}
                          </Button>
                        ) : null}
                        {item.status === 'judgment_confirmed' ? (
                          item.recommendationCaseId ? (
                            <Badge className="h-9 px-3" variant="secondary">建议已生成</Badge>
                          ) : (
                            <Button
                              onClick={() => void onGenerateRecommendation(item.id)}
                              disabled={saving}
                            >
                              <Sparkles className="size-4" />
                              生成调整建议
                            </Button>
                          )
                        ) : null}
                        {canReview ? (
                          <>
                          <Button
                            variant="outline"
                            onClick={() => openReview(item, 'deferred')}
                          >
                            <Clock3 className="size-4" />
                            待定
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => openReview(item, 'rejected')}
                          >
                            <X className="size-4" />
                            否决
                          </Button>
                          <Button
                            onClick={() => openReview(item, 'confirmed')}
                          >
                            <Check className="size-4" />
                            确认判断
                          </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center">
              <SearchCheck className="mx-auto size-5 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-800">
                暂无异常判断
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Doris 发现异常后，第一波分析会先进入这里。
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(reviewAction)} onOpenChange={closeReview}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {reviewAction ? ACTION_LABELS[reviewAction] : '审核判断'}
            </DialogTitle>
            <DialogDescription>
              {selected?.anomalyType} · {selected?.preliminaryJudgment}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-800">
                判断依据 / 原因
              </label>
              <Textarea
                className="mt-2 min-h-24"
                value={reason}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setReason(event.target.value)
                }
                placeholder="说明为什么确认、待定或否决；该信息会进入复盘。"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-800">
                Skill 候选规则（可选）
              </label>
              <Textarea
                className="mt-2 min-h-20"
                value={ruleCandidate}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setRuleCandidate(event.target.value)
                }
                placeholder="例如：数据延迟超过 120 分钟时只报数据质量异常。"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeReview}>
              取消
            </Button>
            <Button
              onClick={() => void submitReview()}
              disabled={saving || !reason.trim()}
            >
              保存判断
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export { JudgmentQueue };
