import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  FlaskConical,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Star,
} from 'lucide-react';

import type {
  GrowthDashboardResponse,
  GrowthDecisionCase,
  GrowthJudgment,
  GrowthProduct,
} from '@shared/api.interface';

import { growthDecision } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const SkillIterationPage: React.FC = () => {
  const [dashboard, setDashboard] = useState<GrowthDashboardResponse | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const load = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      setDashboard(await growthDecision.getDashboard());
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Skill 迭代数据加载失败',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect((): void => {
    void load();
  }, []);

  const products: GrowthProduct[] = dashboard?.products || [];
  const candidates: GrowthJudgment[] = useMemo(
    (): GrowthJudgment[] =>
      (dashboard?.judgments || []).filter(
        (item: GrowthJudgment): boolean =>
          Boolean(item.skillRuleCandidate) || Boolean(item.reviewedAt),
      ).sort(
        (left: GrowthJudgment, right: GrowthJudgment): number =>
          Number(Boolean(right.isFocused)) -
            Number(Boolean(left.isFocused)) ||
          new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
      ),
    [dashboard],
  );
  const completedExperiments: GrowthDecisionCase[] = useMemo(
    (): GrowthDecisionCase[] =>
      (dashboard?.cases || []).filter(
        (item: GrowthDecisionCase): boolean => item.status === 'completed',
      ),
    [dashboard],
  );

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-8 lg:px-8">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-violet-700">
            <Sparkles className="size-4" />SKILL ITERATION
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            产品 Skill 迭代
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            人工确认/否决形成判断规则候选，实验的有效与无效结果形成证据；两者共同进入下一版产品 Skill。
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          刷新证据
        </Button>
      </header>

      {error ? (
        <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        {products.map((product: GrowthProduct) => {
          const productCandidates: GrowthJudgment[] = candidates.filter(
            (item: GrowthJudgment): boolean => item.productId === product.id,
          );
          const productExperiments: GrowthDecisionCase[] =
            completedExperiments.filter(
              (item: GrowthDecisionCase): boolean =>
                item.productId === product.id,
            );
          const effective: number = productExperiments.filter(
            (item: GrowthDecisionCase): boolean =>
              item.resultClassification === 'expected' ||
              item.resultClassification === 'partial',
          ).length;
          const ready: boolean =
            productCandidates.length > 0 && productExperiments.length > 0;

          return (
            <Card key={product.id} className="border-slate-200 bg-white shadow-none">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{product.name}</CardTitle>
                    <p className="mt-1 text-xs text-slate-500">
                      当前 Skill：{product.skillVersion}
                    </p>
                  </div>
                  <Badge variant={ready ? 'default' : 'secondary'}>
                    {ready ? '具备迭代证据' : '证据积累中'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <SkillFact label="规则候选" value={productCandidates.length} />
                  <SkillFact label="完成实验" value={productExperiments.length} />
                  <SkillFact label="有效实验" value={effective} />
                </div>

                <div className="mt-5 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {productCandidates.map((item: GrowthJudgment) => (
                    <article
                      key={item.id}
                      className="rounded-xl border border-slate-200 p-3"
                    >
                      <div className="flex items-center gap-2">
                        {item.isFocused ? (
                          <Star className="size-4 fill-amber-400 text-amber-500" />
                        ) : null}
                        {item.status === 'judgment_confirmed' ? (
                          <CheckCircle2 className="size-4 text-emerald-600" />
                        ) : (
                          <ShieldAlert className="size-4 text-amber-600" />
                        )}
                        <p className="text-xs font-semibold text-slate-900">
                          {item.targetMetric.toUpperCase()} ·{' '}
                          {item.status.replace('judgment_', '')}
                        </p>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">
                        {item.skillRuleCandidate || item.reviewReason || item.preliminaryJudgment}
                      </p>
                    </article>
                  ))}
                  {!productCandidates.length ? (
                    <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-500">
                      尚无人工审核形成的规则候选。
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 rounded-xl bg-violet-50 p-4 text-xs leading-5 text-violet-800">
                  <span className="font-semibold">下一版建议：</span>
                  {ready
                    ? `将 ${productCandidates.length} 条判断候选与 ${productExperiments.length} 条实验结果纳入复盘，区分有效和无效规则后再发布新版本。`
                    : '继续积累人工判断与完成实验；未形成结果闭环前不自动修改线上规则。'}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {!loading && !products.length ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <FlaskConical className="mx-auto size-6 text-slate-400" />
          <p className="mt-3 text-sm text-slate-600">暂无产品 Skill。</p>
        </div>
      ) : null}
    </div>
  );
};

interface SkillFactProps {
  label: string;
  value: number;
}

const SkillFact: React.FC<SkillFactProps> = ({ label, value }) => (
  <div className="rounded-xl bg-slate-50 p-3 text-center">
    <p className="text-[11px] text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-semibold text-slate-950">{value}</p>
  </div>
);

export default SkillIterationPage;
