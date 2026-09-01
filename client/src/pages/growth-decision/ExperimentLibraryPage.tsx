import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type {
  GrowthDashboardResponse,
  GrowthDecisionCase,
} from '@shared/api.interface';

import { growthDecision } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const EXPERIMENT_STATUS: Record<string, string> = {
  pending: '待确认',
  accepted: '观察中',
  observing: '观察中',
  rejected: '未采纳',
  completed: '已完成',
};

const ExperimentLibraryPage: React.FC = () => {
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
          : '实验库加载失败',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect((): void => {
    void load();
  }, []);

  const experiments: GrowthDecisionCase[] = useMemo(
    (): GrowthDecisionCase[] => dashboard?.cases || [],
    [dashboard],
  );
  const completed: GrowthDecisionCase[] = experiments.filter(
    (item: GrowthDecisionCase): boolean => item.status === 'completed',
  );
  const improved: GrowthDecisionCase[] = completed.filter(
    (item: GrowthDecisionCase): boolean =>
      item.resultClassification === 'expected' ||
      item.resultClassification === 'partial',
  );

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-8 lg:px-8">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-blue-700">
            <Database className="size-4" />EXPERIMENT LIBRARY
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            实验与结果追踪
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            每条建议追踪到产品、Campaign、广告组与执行结果；判断确认本身不计入建议采纳率。
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </header>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <SummaryCard label="建议总数" value={experiments.length} icon={<Database />} />
        <SummaryCard label="完成实验" value={completed.length} icon={<CheckCircle2 />} />
        <SummaryCard
          label="产生预期改善"
          value={completed.length ? `${Math.round((improved.length / completed.length) * 100)}%` : '—'}
          icon={<TrendingUp />}
        />
      </section>

      {error ? (
        <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="mt-6 max-h-[660px] space-y-3 overflow-y-auto pr-2">
        {experiments.map((item: GrowthDecisionCase) => (
          <Card key={item.id} className="border-slate-200 bg-white shadow-none">
            <CardContent className="p-5">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {EXPERIMENT_STATUS[item.status] || item.status}
                    </Badge>
                    <span className="text-xs font-medium text-slate-600">
                      {item.productName} · {item.channel}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-950">
                    {item.recommendation}
                  </p>
                  <p className="mt-2 truncate text-xs text-slate-500">
                    Campaign：{item.campaignName || '产品级'} · 广告组：
                    {item.adsetName || '未指定'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                    <span>动作：{item.recommendedAction.actionType || '待定义'}</span>
                    <span>预期：{item.expectedImpact}</span>
                    <span>
                      实际：{item.actualResult || '尚未回填'}
                    </span>
                  </div>
                </div>
                <Link to={`/products/${item.productId}`}>
                  <Button variant="outline">
                    查看产品闭环 <ArrowRight className="size-4" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
        {!loading && experiments.length === 0 ? (
          <Card className="border-dashed shadow-none">
            <CardHeader className="items-center py-14 text-center">
              <Clock3 className="size-6 text-slate-400" />
              <CardTitle className="text-base">还没有实验记录</CardTitle>
              <p className="text-sm text-slate-500">
                确认异常并生成调整建议后，记录会自动进入这里。
              </p>
            </CardHeader>
          </Card>
        ) : null}
      </section>
    </div>
  );
};

interface SummaryCardProps {
  label: string;
  value: string | number;
  icon: React.ReactElement;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, icon }) => (
  <Card className="border-slate-200 bg-white shadow-none" data-ai-section-type="card-stat">
    <CardContent className="flex items-center justify-between p-5">
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      </div>
      <span className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 [&>svg]:size-4">
        {icon}
      </span>
    </CardContent>
  </Card>
);

export default ExperimentLibraryPage;
