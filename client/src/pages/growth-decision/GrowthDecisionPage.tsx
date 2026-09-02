import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  X,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import type {
  GrowthAdAccount,
  GrowthAnalysisMode,
  GrowthAiProviderStatus,
  GrowthDashboardResponse,
  GrowthDecisionCase,
  GrowthDashboardSummary,
  GrowthJudgment,
  GrowthProduct,
  ReviewJudgmentRequest,
  UpdateDecisionRequest,
} from '@shared/api.interface';

import { growthDecision } from '@/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';

import { JudgmentQueue } from './JudgmentQueue';
import { ObservationQueue } from './ObservationQueue';
import { FetchHistoryControl } from './FetchHistoryControl';
import { DecisionHistoryDrawer } from './DecisionHistoryDrawer';

interface StatCardProps {
  label: string;
  value: string;
  note: string;
  tone: 'neutral' | 'warning' | 'success' | 'info';
}

const REJECTION_REASONS: string[] = [
  '样本量不足，继续观察',
  '调整风险高于预期收益',
  '已有其他投放调整正在进行',
  '原因分析与业务实际不符',
];

const STATUS_LABELS: Record<string, string> = {
  pending: '待决策',
  accepted: '已采纳',
  rejected: '未采纳',
  observing: '观察中',
  completed: '已完成',
};

const SEVERITY_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '紧急',
};

const experimentHideAt = (item: GrowthDecisionCase): number => {
  if (item.status !== 'completed') return Number.POSITIVE_INFINITY;
  if (item.hideAfterAt) return new Date(item.hideAfterAt).getTime();
  const endedAt: string =
    item.observationEndedAt || item.completedAt || item.createdAt;
  return new Date(endedAt).getTime() + 7 * 24 * 60 * 60 * 1000;
};

const experimentRetentionLabel = (item: GrowthDecisionCase): string => {
  if (item.status !== 'completed') return '持续观察中';
  const remainingMs: number = Math.max(0, experimentHideAt(item) - Date.now());
  const remainingDays: number = Math.max(
    1,
    Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
  );
  return `${remainingDays} 天后移出`;
};

const StatCard: React.FC<StatCardProps> = ({ label, value, note, tone }) => {
  const toneClass: Record<StatCardProps['tone'], string> = {
    neutral: 'bg-slate-100 text-slate-700',
    warning: 'bg-amber-50 text-amber-700',
    success: 'bg-emerald-50 text-emerald-700',
    info: 'bg-blue-50 text-blue-700',
  };

  return (
    <Card
      className="border-slate-200 bg-white shadow-none"
      data-ai-section-type="card-stat"
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              {value}
            </p>
          </div>
          <span
            className={`rounded-lg px-2 py-1 text-[11px] font-medium ${toneClass[tone]}`}
          >
            {note}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

const GrowthDecisionPage: React.FC = () => {
  const { productId = '' } = useParams<{ productId: string }>();
  const [dashboardData, setDashboardData] =
    useState<GrowthDashboardResponse | null>(null);
  const [selectedCase, setSelectedCase] = useState<GrowthDecisionCase | null>(
    null,
  );
  const [rejectingCase, setRejectingCase] = useState<GrowthDecisionCase | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [aiStatus, setAiStatus] = useState<GrowthAiProviderStatus | null>(null);

  useEffect((): void => {
    void loadDashboard();
  }, [productId]);

  useEffect((): (() => void) | undefined => {
    const hasRunningAnalysis: boolean = Boolean(
      dashboardData?.judgments.some(
        (item: GrowthJudgment): boolean => item.aiAnalysisStatus === 'running',
      ),
    );
    if (!hasRunningAnalysis) return undefined;
    const timer: number = window.setTimeout((): void => {
      void loadDashboard();
    }, 3_000);
    return (): void => window.clearTimeout(timer);
  }, [dashboardData]);

  const loadDashboard = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const [response, providerStatus]: [
        GrowthDashboardResponse,
        GrowthAiProviderStatus,
      ] = await Promise.all([
        growthDecision.getDashboard(),
        growthDecision.getAiStatus(productId),
      ]);
      setDashboardData(response);
      setAiStatus(providerStatus);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : '工作台加载失败',
      );
    } finally {
      setLoading(false);
    }
  };

  const dashboard: GrowthDashboardResponse | null = useMemo(() => {
    if (!dashboardData) return null;
    const products = dashboardData.products.filter(
      (product) => product.id === productId,
    );
    const judgments = dashboardData.judgments.filter(
      (item) => item.productId === productId,
    );
    const cases = dashboardData.cases.filter(
      (item) => item.productId === productId,
    );
    const accepted = cases.filter(
      (item) =>
        item.status === 'accepted' ||
        item.status === 'observing' ||
        item.status === 'completed',
    );
    const completed = cases.filter((item) => item.status === 'completed');
    const improved = completed.filter(
      (item) =>
        item.resultClassification === 'expected' ||
        item.resultClassification === 'partial',
    );
    return {
      products,
      judgments,
      cases,
      summary: {
        openAnomalies: judgments.length,
        pendingJudgments: judgments.filter(
          (item) =>
            item.status === 'judgment_pending' ||
            item.status === 'judgment_deferred',
        ).length,
        confirmedJudgments: judgments.filter(
          (item) => item.status === 'judgment_confirmed',
        ).length,
        pendingDecisions: cases.filter((item) => item.status === 'pending')
          .length,
        acceptedRecommendations: accepted.length,
        completedExperiments: completed.length,
        expectedImprovementRate: completed.length
          ? Math.round((improved.length / completed.length) * 100)
          : 0,
        medianDecisionMinutes: dashboardData.summary.medianDecisionMinutes,
        lastDataSyncAt: products[0]?.lastSyncAt,
      },
    };
  }, [dashboardData, productId]);
  const selectedProduct: GrowthProduct | undefined = dashboard?.products[0];

  const handleDecision = async (
    item: GrowthDecisionCase,
    action: UpdateDecisionRequest['action'],
    reason: string,
  ): Promise<void> => {
    setSaving(true);
    setError('');
    try {
      await growthDecision.updateDecision(item.id, { action, reason });
      setSelectedCase(null);
      setRejectingCase(null);
      await loadDashboard();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : '决策保存失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleJudgmentReview = async (
    id: string,
    request: ReviewJudgmentRequest,
  ): Promise<void> => {
    setSaving(true);
    setError('');
    try {
      await growthDecision.reviewJudgment(id, request);
      if (request.action === 'confirmed') {
        await growthDecision.generateRecommendation(id);
      }
      await loadDashboard();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : '判断保存失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateRecommendation = async (id: string): Promise<void> => {
    setSaving(true);
    setError('');
    try {
      await growthDecision.generateRecommendation(id);
      await loadDashboard();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '调整建议生成失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAiAnalysis = async (id: string): Promise<void> => {
    setSaving(true);
    setError('');
    try {
      await growthDecision.analyzeJudgment(id);
      await loadDashboard();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '异常深度分析失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleBatchAnalysis = async (): Promise<void> => {
    if (!productId) return;
    setSaving(true);
    setError('');
    try {
      await growthDecision.analyzeProductBatch(productId);
      await loadDashboard();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '整批异常分析创建失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAnalysisModeChange = async (
    mode: GrowthAnalysisMode,
  ): Promise<void> => {
    if (!productId || aiStatus?.selectedMode === mode) return;
    setSaving(true);
    setError('');
    try {
      await growthDecision.updateAnalysisMode(productId, mode);
      await loadDashboard();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '分析模式切换失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFocus = async (
    id: string,
    focused: boolean,
  ): Promise<void> => {
    setSaving(true);
    setError('');
    try {
      await growthDecision.updateRecordFocus(id, { focused });
      await loadDashboard();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '重点关注状态保存失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEndRecoveredExperiment = async (
    item: GrowthDecisionCase,
  ): Promise<void> => {
    if (!item.recoveryReadyAt) return;
    const baselineValue: number | undefined = item.baselineValue;
    const latestValue: number | undefined = item.latestObservedValue;
    const actualChangePct: number =
      baselineValue && latestValue !== undefined
        ? Number((((latestValue - baselineValue) / baselineValue) * 100).toFixed(2))
        : 0;
    setSaving(true);
    setError('');
    try {
      await growthDecision.updateResult(item.id, {
        classification: 'expected',
        actualChangePct,
        actualResult:
          'Doris 已确认目标指标连续 24 小时处于产品指标库正常范围，人工结束实验。',
      });
      setSelectedCase(null);
      await loadDashboard();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '实验结束状态保存失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const pendingCases: GrowthDecisionCase[] = useMemo(
    (): GrowthDecisionCase[] =>
      (dashboard?.cases || [])
        .filter(
          (item: GrowthDecisionCase): boolean => item.status === 'pending',
        )
        .sort(
          (left: GrowthDecisionCase, right: GrowthDecisionCase): number =>
            Number(Boolean(right.isFocused)) -
              Number(Boolean(left.isFocused)) ||
            new Date(right.createdAt).getTime() -
              new Date(left.createdAt).getTime(),
        ),
    [dashboard],
  );
  const activeCases: GrowthDecisionCase[] = useMemo(
    (): GrowthDecisionCase[] =>
      (dashboard?.cases || [])
        .filter(
          (item: GrowthDecisionCase): boolean =>
            ['accepted', 'observing', 'completed'].includes(item.status) &&
            experimentHideAt(item) > Date.now(),
        )
        .sort(
          (left: GrowthDecisionCase, right: GrowthDecisionCase): number =>
            Number(Boolean(right.isFocused)) -
              Number(Boolean(left.isFocused)) ||
            experimentHideAt(left) - experimentHideAt(right),
        ),
    [dashboard],
  );
  const summary: GrowthDashboardSummary | undefined = dashboard?.summary;

  if (loading && !dashboardData) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center gap-3 text-sm text-slate-500">
        <RefreshCw className="size-4 animate-spin" />
        正在加载增长决策工作台
      </div>
    );
  }

  if (!loading && dashboardData && !selectedProduct) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-20 text-center">
        <Database className="mx-auto size-7 text-slate-400" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">
          产品页面不存在
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          该产品可能尚未接入或已停用。
        </p>
        <Button asChild variant="outline" className="mt-5">
          <Link to="/">返回产品中心</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1540px] px-5 py-6 lg:px-8">
      <section className="mb-6 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <Link
            to="/"
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="size-3.5" />
            返回产品中心
          </Link>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-blue-700">
            <Sparkles className="size-3.5" />
            {selectedProduct?.name.toUpperCase()} · PRODUCT DECISION PAGE
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 lg:text-3xl">
            {selectedProduct?.name} 增长判断与投放决策
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            本页面只使用 {selectedProduct?.name} 的 Doris 数据、Facebook
            账户和产品 Skill；先判断异常是否成立，确认后再生成调整建议。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700"
          >
            <span className="size-1.5 rounded-full bg-emerald-500" />
            公司 Mac 局域网服务
          </Badge>
          <FetchHistoryControl
            productId={productId}
            onCompleted={loadDashboard}
            onError={setError}
          />
          <Button
            variant="outline"
            onClick={() => void loadDashboard()}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive" className="mb-5">
          <AlertTriangle className="size-4" />
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="待判断异常"
          value={String(summary?.pendingJudgments || 0)}
          note="目标 ≤ 2h"
          tone="warning"
        />
        <StatCard
          label="已采纳建议"
          value={String(summary?.acceptedRecommendations || 0)}
          note="闭环追踪"
          tone="info"
        />
        <StatCard
          label="完成实验"
          value={String(summary?.completedExperiments || 0)}
          note="实验数据库"
          tone="neutral"
        />
        <StatCard
          label="预期改善率"
          value={`${summary?.expectedImprovementRate || 0}%`}
          note="KR3 ≥ 50%"
          tone="success"
        />
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <JudgmentQueue
            judgments={dashboard?.judgments || []}
            saving={saving}
            onReview={handleJudgmentReview}
            onGenerateRecommendation={handleGenerateRecommendation}
            onAnalyze={handleAiAnalysis}
            onAnalyzeBatch={handleBatchAnalysis}
            onAnalysisModeChange={handleAnalysisModeChange}
            onToggleFocus={handleToggleFocus}
            analysisMode={aiStatus?.selectedMode || 'product_skill'}
            mavisConfigured={Boolean(aiStatus?.configured)}
            mavisModel={aiStatus?.model || 'Codex Growth Analyst'}
            mavisRuntimeMode={aiStatus?.runtimeMode || 'skill_simulation'}
            mavisQueuedJobs={aiStatus?.queuedJobs || 0}
          />

          <ObservationQueue
            judgments={dashboard?.judgments || []}
            saving={saving}
            onReview={handleJudgmentReview}
            onToggleFocus={handleToggleFocus}
          />

          <Card className="border-slate-200 bg-white shadow-none">
            <CardHeader className="flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">待确认调整建议</CardTitle>
                <CardDescription className="mt-1">
                  仅由已确认的异常判断生成，并绑定到具体投放对象
                </CardDescription>
              </div>
              <Badge variant="secondary">{pendingCases.length} 条</Badge>
            </CardHeader>
            <CardContent>
              {pendingCases.length ? (
                <div
                  className="max-h-[34rem] space-y-3 overflow-y-auto overscroll-contain pr-2"
                  data-ai-section-type="card-list"
                >
                  {pendingCases.map((item: GrowthDecisionCase) => (
                    <article
                      key={item.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
                    >
                      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                item.severity === 'critical' ||
                                item.severity === 'high'
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                              }
                            >
                              {SEVERITY_LABELS[item.severity] || item.severity}
                              风险
                            </Badge>
                            <span className="text-xs text-slate-500">
                              {item.productName}
                            </span>
                            <span className="text-xs text-slate-300">/</span>
                            <span className="truncate text-xs text-slate-500">
                              {item.campaignName ||
                                item.campaignId ||
                                'Campaign 未命名'}
                            </span>
                          </div>
                          <h2 className="mt-3 text-sm font-semibold text-slate-950">
                            {item.anomalyType} ·{' '}
                            {item.targetMetric.toUpperCase()}
                            {typeof item.deviationPct === 'number'
                              ? ` ${item.deviationPct > 0 ? '+' : ''}${item.deviationPct}%`
                              : ''}
                          </h2>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                            {item.rootCause}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1.5">
                              <Bot className="size-3.5" />
                              原因置信度 {item.confidence}%
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Target className="size-3.5" />
                              {item.expectedImpact}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            variant={item.isFocused ? 'secondary' : 'outline'}
                            className={
                              item.isFocused
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : ''
                            }
                            disabled={saving}
                            onClick={() =>
                              void handleToggleFocus(item.id, !item.isFocused)
                            }
                          >
                            <Star
                              className={`size-4 ${item.isFocused ? 'fill-current' : ''}`}
                            />
                            {item.isFocused ? '重点关注' : '设为重点'}
                          </Button>
                          <DecisionHistoryDrawer
                            recordId={item.id}
                            title={`${item.productName} · ${item.recommendation}`}
                          />
                          <Button
                            variant="outline"
                            onClick={() => setSelectedCase(item)}
                          >
                            查看依据
                            <ChevronRight className="size-4" />
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setRejectingCase(item)}
                          >
                            <X className="size-4" />
                            不采纳
                          </Button>
                          <Button
                            onClick={() =>
                              void handleDecision(
                                item,
                                'accepted',
                                '接受 Agent 建议',
                              )
                            }
                            disabled={saving}
                          >
                            <Check className="size-4" />
                            采纳建议
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty className="min-h-64">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Database className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>暂无调整建议</EmptyTitle>
                    <EmptyDescription>
                      异常判断确认成立后，Agent 才会生成第一条调整建议。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-none">
            <CardHeader>
              <CardTitle className="text-base">实验与结果追踪</CardTitle>
              <CardDescription>已决策建议的观察状态和业务结果</CardDescription>
            </CardHeader>
            <CardContent>
              {activeCases.length ? (
                <div
                  className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto overscroll-contain pr-2"
                  data-ai-section-type="card-list"
                >
                  {activeCases.map((item: GrowthDecisionCase) => (
                    <article
                      key={item.id}
                      className="flex flex-col justify-between gap-3 py-4 lg:flex-row lg:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.isFocused ? (
                            <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                              <Star className="size-3 fill-current" /> 重点关注
                            </Badge>
                          ) : null}
                          <Badge variant="outline">
                            {STATUS_LABELS[item.status] || item.status}
                          </Badge>
                          <Badge variant="secondary">
                            {experimentRetentionLabel(item)}
                          </Badge>
                          {item.recoveryReadyAt ? (
                            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                              已连续正常 24 小时，可结束
                            </Badge>
                          ) : item.normalSince ? (
                            <Badge className="border-blue-200 bg-blue-50 text-blue-700">
                              正常区间观察中
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-2 truncate text-sm font-medium text-slate-900">
                          {item.productName} · {item.recommendation}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.campaignName ||
                            item.campaignId ||
                            '未指定 Campaign'}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          variant={item.isFocused ? 'secondary' : 'outline'}
                          size="sm"
                          className={
                            item.isFocused
                              ? 'border-amber-200 bg-amber-50 text-amber-700'
                              : ''
                          }
                          disabled={saving}
                          onClick={() =>
                            void handleToggleFocus(item.id, !item.isFocused)
                          }
                        >
                          <Star
                            className={`size-4 ${item.isFocused ? 'fill-current' : ''}`}
                          />
                          {item.isFocused ? '重点关注' : '设为重点'}
                        </Button>
                        {item.recoveryReadyAt && item.status !== 'completed' ? (
                          <Button
                            size="sm"
                            disabled={saving}
                            onClick={() =>
                              void handleEndRecoveredExperiment(item)
                            }
                          >
                            <Check className="size-4" />
                            结束实验
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedCase(item)}
                        >
                          查看详情 <ChevronRight className="size-4" />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-slate-500">
                  暂无已决策实验
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="border-slate-200 bg-slate-950 text-white shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ShieldCheck className="size-4 text-emerald-400" />
                KR 进度
              </CardTitle>
              <CardDescription className="text-slate-400">
                基于当前真实记录计算
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="mb-2 flex justify-between text-xs">
                  <span className="text-slate-300">全链路覆盖</span>
                  <span>
                    {dashboard?.products.length ? '已覆盖' : '未覆盖'}
                  </span>
                </div>
                <Progress
                  value={dashboard?.products.length ? 100 : 12}
                  className="bg-slate-800"
                />
              </div>
              <div>
                <div className="mb-2 flex justify-between text-xs">
                  <span className="text-slate-300">建议可追踪率</span>
                  <span>{dashboard?.cases.length ? '100%' : '0%'}</span>
                </div>
                <Progress
                  value={dashboard?.cases.length ? 100 : 0}
                  className="bg-slate-800"
                />
              </div>
              <div>
                <div className="mb-2 flex justify-between text-xs">
                  <span className="text-slate-300">建议改善率</span>
                  <span>{summary?.expectedImprovementRate || 0}% / 50%</span>
                </div>
                <Progress
                  value={Math.min(
                    100,
                    (summary?.expectedImprovementRate || 0) * 2,
                  )}
                  className="bg-slate-800"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-none">
            <CardHeader>
              <CardTitle className="text-base">数据与 Skill</CardTitle>
              <CardDescription>产品级运行配置</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboard?.products.length ? (
                dashboard.products.map((product: GrowthProduct) => (
                  <div
                    key={product.id}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-900">
                        {product.name}
                      </p>
                      <Badge variant="outline">
                        产品 Skill {product.skillVersion}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <span>目标：{product.targetMetric.toUpperCase()}</span>
                      <span>延迟：{product.dataDelayMinutes} 分钟</span>
                      <span>
                        活跃账户：
                        {
                          (product.adAccounts || []).filter(
                            (account: GrowthAdAccount): boolean =>
                              account.activityStatus === 'active' ||
                              account.activityStatus === 'new',
                          ).length
                        }{' '}
                        个
                      </span>
                      <span>渠道：{product.channel.toUpperCase()}</span>
                    </div>
                    <div className="mt-3 rounded-lg bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-slate-700">
                          动态广告账户
                        </span>
                        <span className="text-slate-500">
                          已发现 {product.accountIds.length} 个
                        </span>
                      </div>
                      <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto pr-1">
                        {(product.adAccounts || []).map(
                          (account: GrowthAdAccount) => (
                            <div
                              key={account.id}
                              className="flex items-center justify-between gap-3 rounded-md bg-white px-2 py-1.5 text-[11px]"
                            >
                              <span className="font-mono text-slate-700">
                                {account.id}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400">
                                  30d ${account.spend30d.toFixed(2)}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={
                                    account.activityStatus === 'new'
                                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                                      : account.activityStatus === 'active'
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-slate-200 bg-slate-100 text-slate-500'
                                  }
                                >
                                  {account.activityStatus === 'new'
                                    ? '新发现'
                                    : account.activityStatus === 'active'
                                      ? '活跃'
                                      : account.activityStatus === 'inactive'
                                        ? '无近期投放'
                                        : '待同步'}
                                </Badge>
                              </div>
                            </div>
                          ),
                        )}
                        {!product.adAccounts?.length ? (
                          <p className="py-2 text-center text-[11px] text-slate-400">
                            下次 Doris 抓取会自动发现账户。
                          </p>
                        ) : null}
                      </div>
                      <p className="mt-2 text-[10px] leading-4 text-slate-400">
                        “无近期投放”仅表示最近 3 天 Doris 无消耗，封户状态仍需
                        Facebook API 确认；历史账户不会被自动删除。
                      </p>
                    </div>
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">达标标准</span>
                        <span className="font-medium text-slate-800">
                          {product.metrics.filter(
                            (metric) => metric.standardValue !== undefined,
                          ).length
                            ? `${product.metrics.filter((metric) => metric.standardValue !== undefined).length} 项已录入`
                            : '待产品负责人校准'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">异常规则</span>
                        <span className="font-medium text-slate-800">
                          {
                            product.metrics.filter(
                              (metric) =>
                                metric.lowerBound !== undefined ||
                                metric.upperBound !== undefined,
                            ).length
                          }{' '}
                          项阈值已启用
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">最近取数</span>
                        <span className="font-medium text-slate-800">
                          {product.lastSyncAt
                            ? new Date(product.lastSyncAt).toLocaleString(
                                'zh-CN',
                                { hour12: false },
                              )
                            : '尚未同步'}
                        </span>
                      </div>
                    </div>
                    {product.dorisSource ? (
                      <p
                        className="mt-3 line-clamp-3 rounded-lg bg-slate-50 p-2 text-[11px] leading-5 text-slate-500"
                        title={product.dorisSource}
                      >
                        Doris：{product.dorisSource}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  尚未配置产品。通过产品接入接口写入首个产品后即可开始运行。
                </div>
              )}
              <div className="rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                <div className="flex items-center gap-2 font-medium">
                  <Clock3 className="size-3.5" />
                  自动化节奏
                </div>
                <p className="mt-1">
                  每小时 Doris 抓取已启用；手动抓取与结果历史可在页面顶部查看。
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-none">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
                  <CheckCircle2 className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    下一次周复盘
                  </p>
                  <p className="text-xs text-slate-500">
                    周一 10:00 · 自动汇总实验结果
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog
        open={Boolean(selectedCase)}
        onOpenChange={(open: boolean) => !open && setSelectedCase(null)}
      >
        <DialogContent className="max-h-[86vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedCase?.anomalyType || '建议详情'}</DialogTitle>
            <DialogDescription>
              {selectedCase?.productName} ·{' '}
              {selectedCase?.campaignName ||
                selectedCase?.campaignId ||
                '广告对象'}
            </DialogDescription>
          </DialogHeader>
          {selectedCase ? (
            <div className="space-y-5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  variant={selectedCase.isFocused ? 'secondary' : 'outline'}
                  className={
                    selectedCase.isFocused
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : ''
                  }
                  disabled={saving}
                  onClick={() =>
                    void handleToggleFocus(
                      selectedCase.id,
                      !selectedCase.isFocused,
                    )
                  }
                >
                  <Star
                    className={`size-4 ${selectedCase.isFocused ? 'fill-current' : ''}`}
                  />
                  {selectedCase.isFocused ? '重点关注' : '设为重点关注'}
                </Button>
                {selectedCase.recoveryReadyAt &&
                selectedCase.status !== 'completed' ? (
                  <Button
                    disabled={saving}
                    onClick={() =>
                      void handleEndRecoveredExperiment(selectedCase)
                    }
                  >
                    <Check className="size-4" />
                    指标已连续正常，结束实验
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">当前值</p>
                  <p className="mt-1 font-semibold">
                    {selectedCase.currentValue ?? '—'}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">基线值</p>
                  <p className="mt-1 font-semibold">
                    {selectedCase.baselineValue ?? '—'}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">变化幅度</p>
                  <p className="mt-1 flex items-center gap-1 font-semibold">
                    {(selectedCase.deviationPct || 0) >= 0 ? (
                      <ArrowUpRight className="size-4 text-red-500" />
                    ) : (
                      <ArrowDownRight className="size-4 text-emerald-500" />
                    )}
                    {selectedCase.deviationPct ?? '—'}%
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">数据证据</p>
                <p className="mt-1 leading-6 text-slate-700">
                  {selectedCase.evidence}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">
                  原因分析 · 置信度 {selectedCase.confidence}%
                </p>
                <p className="mt-1 leading-6 text-slate-700">
                  {selectedCase.rootCause}
                </p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="text-xs font-medium text-blue-700">行动建议</p>
                <p className="mt-1 font-medium leading-6 text-blue-950">
                  {selectedCase.recommendation}
                </p>
                <p className="mt-2 text-xs text-blue-800">
                  预期：{selectedCase.expectedImpact}
                </p>
              </div>
              {selectedCase.riskNote ? (
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    风险与回滚条件
                  </p>
                  <p className="mt-1 leading-6 text-slate-700">
                    {selectedCase.riskNote}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(rejectingCase)}
        onOpenChange={(open: boolean) => !open && setRejectingCase(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>选择不采纳原因</DialogTitle>
            <DialogDescription>
              原因会写入实验数据库，用于每周复盘和 Skill 改进。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {REJECTION_REASONS.map((reason: string) => (
              <Button
                key={reason}
                variant="outline"
                className="h-auto justify-start whitespace-normal py-3 text-left"
                disabled={saving || !rejectingCase}
                onClick={() =>
                  rejectingCase &&
                  void handleDecision(rejectingCase, 'rejected', reason)
                }
              >
                {reason}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GrowthDecisionPage;
