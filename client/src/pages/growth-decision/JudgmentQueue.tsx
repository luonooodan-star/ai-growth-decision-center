import React, { useMemo, useState } from 'react';
import {
  BrainCircuit,
  ChevronRight,
  SearchCheck,
  WalletCards,
} from 'lucide-react';

import type {
  GrowthAnalysisMode,
  GrowthJudgment,
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

import { JudgmentDetailDrawer } from './JudgmentDetailDrawer';

interface JudgmentQueueProps {
  judgments: GrowthJudgment[];
  saving: boolean;
  onReview: (id: string, request: ReviewJudgmentRequest) => Promise<void>;
  onGenerateRecommendation: (id: string) => Promise<void>;
  onAnalyze: (id: string) => Promise<void>;
  onAnalyzeBatch: () => Promise<void>;
  onAnalysisModeChange: (mode: GrowthAnalysisMode) => Promise<void>;
  analysisMode: GrowthAnalysisMode;
  mavisConfigured: boolean;
  mavisModel: string;
  mavisRuntimeMode: 'external_worker' | 'skill_simulation';
  mavisQueuedJobs: number;
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

const COMPACT_AI_JUDGMENT_LABELS: Record<string, string> = {
  confirmed: 'Marvis 判断成立',
  uncertain: 'Marvis 判断待定',
  rejected: 'Marvis 判断不成立',
};

const JudgmentQueue: React.FC<JudgmentQueueProps> = ({
  judgments,
  saving,
  onReview,
  onGenerateRecommendation,
  onAnalyze,
  onAnalyzeBatch,
  onAnalysisModeChange,
  analysisMode,
  mavisConfigured,
  mavisModel,
  mavisRuntimeMode,
  mavisQueuedJobs,
}) => {
  const [detailId, setDetailId] = useState<string>('');
  const [selected, setSelected] = useState<GrowthJudgment | null>(null);
  const [reviewAction, setReviewAction] = useState<
    ReviewJudgmentRequest['action'] | null
  >(null);
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
  const detailItem: GrowthJudgment | null =
    judgments.find((item: GrowthJudgment): boolean => item.id === detailId) ||
    null;
  const openJudgmentCount: number = judgments.filter(
    (item: GrowthJudgment): boolean =>
      item.status === 'judgment_pending' || item.status === 'judgment_deferred',
  ).length;

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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              <Button
                size="sm"
                variant={analysisMode === 'marvis_bridge' ? 'default' : 'ghost'}
                className="h-7 px-2 text-xs"
                disabled={saving}
                onClick={() => void onAnalysisModeChange('marvis_bridge')}
              >
                Marvis 任务桥
              </Button>
              <Button
                size="sm"
                variant={analysisMode === 'product_skill' ? 'default' : 'ghost'}
                className="h-7 px-2 text-xs"
                disabled={saving}
                onClick={() => void onAnalysisModeChange('product_skill')}
              >
                产品 Skill
              </Button>
            </div>
            <Button
              size="sm"
              disabled={
                saving ||
                openJudgmentCount === 0 ||
                (analysisMode === 'marvis_bridge' && !mavisConfigured)
              }
              onClick={() => void onAnalyzeBatch()}
            >
              <BrainCircuit className="size-4" />
              {analysisMode === 'marvis_bridge'
                ? `创建整批分析（${openJudgmentCount}）`
                : `运行 Skill 分析（${openJudgmentCount}）`}
            </Button>
            {mavisQueuedJobs > 0 ? (
              <Badge variant="outline">排队 {mavisQueuedJobs}</Badge>
            ) : null}
            <Badge variant="secondary">{judgments.length} 条</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {orderedJudgments.length ? (
            <div
              className="max-h-[34rem] space-y-3 overflow-y-auto overscroll-contain pr-2"
              data-ai-section-type="card-list"
            >
              {orderedJudgments.map((item: GrowthJudgment) => (
                <article
                  key={item.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/20"
                >
                  <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {STATUS_LABELS[item.status] || item.status}
                        </Badge>
                        <span className="text-xs font-medium text-slate-600">
                          {item.productName}
                        </span>
                        <span className="max-w-full truncate text-xs text-slate-500 lg:max-w-md">
                          Campaign：
                          {item.campaignName || item.campaignId || '产品级'}
                        </span>
                        <span className="max-w-full truncate text-xs text-slate-500 lg:max-w-64">
                          广告组：{item.adsetName || item.adsetId || '未定位'}
                        </span>
                      </div>
                      <h2 className="mt-2 truncate text-sm font-semibold text-slate-950">
                        {item.anomalyType}
                        {typeof item.deviationPct === 'number'
                          ? ` · ${item.deviationPct > 0 ? '+' : ''}${item.deviationPct}%`
                          : ''}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 font-medium text-blue-700">
                          <WalletCards className="size-3" /> 消耗{' '}
                          {item.spend === undefined
                            ? '—'
                            : `$${item.spend.toFixed(2)}`}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-1">
                          {item.targetMetric.toUpperCase()} 当前值{' '}
                          {item.currentValue === undefined
                            ? '—'
                            : item.targetMetric === 'd0_roas' ||
                                item.targetMetric === 'retention_d1'
                              ? `${(item.currentValue * 100).toFixed(2)}%`
                              : item.currentValue.toFixed(3)}
                        </span>
                        <span>置信度 {item.confidence}%</span>
                        {item.diagnosticContext?.changesPct[
                          item.targetMetric
                        ] !== undefined ? (
                          <Badge variant="outline">
                            较历史均值{' '}
                            {item.diagnosticContext.changesPct[
                              item.targetMetric
                            ]! > 0
                              ? '提升'
                              : '下降'}{' '}
                            {Math.abs(
                              item.diagnosticContext.changesPct[
                                item.targetMetric
                              ]!,
                            ).toFixed(1)}
                            %
                          </Badge>
                        ) : null}
                        {item.aiAnalysisStatus === 'running' ? (
                          <Badge variant="outline">
                            {mavisRuntimeMode === 'external_worker'
                              ? 'Marvis 等待/分析中'
                              : 'Marvis 分析中'}
                          </Badge>
                        ) : item.aiAnalysis ? (
                          <Badge
                            variant="outline"
                            className="border-violet-200 bg-violet-50 text-violet-700"
                          >
                            <BrainCircuit className="size-3" />
                            {item.aiAnalysis.provider === 'product_skill'
                              ? `Skill ${
                                  item.aiAnalysis.judgment === 'confirmed'
                                    ? '判断成立'
                                    : item.aiAnalysis.judgment === 'uncertain'
                                      ? '判断待定'
                                      : '判断不成立'
                                }`
                              : COMPACT_AI_JUDGMENT_LABELS[
                                  item.aiAnalysis.judgment
                                ] || item.aiAnalysis.judgment}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setDetailId(item.id)}
                    >
                      查看与处理 <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center">
              <SearchCheck className="mx-auto size-5 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-800">
                暂无异常判断
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Doris
                发现异常后，会先展示历史升降对比；深度分析由上方按钮统一触发。
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <JudgmentDetailDrawer
        item={detailItem}
        open={Boolean(detailItem)}
        saving={saving}
        mavisConfigured={mavisConfigured}
        mavisModel={mavisModel}
        mavisRuntimeMode={mavisRuntimeMode}
        onOpenChange={(open: boolean) => {
          if (!open) setDetailId('');
        }}
        onAnalyze={onAnalyze}
        onGenerateRecommendation={onGenerateRecommendation}
        onReview={openReview}
      />

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
