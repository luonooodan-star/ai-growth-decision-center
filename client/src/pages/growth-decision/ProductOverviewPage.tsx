import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type {
  GrowthDashboardResponse,
  GrowthProduct,
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

const ProductOverviewPage: React.FC = () => {
  const [dashboard, setDashboard] = useState<GrowthDashboardResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const load = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      setDashboard(await growthDecision.getDashboard());
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : '产品中心加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect((): void => { void load(); }, []);

  const activeProducts: GrowthProduct[] = useMemo(
    () => dashboard?.products.filter((product: GrowthProduct) => product.status === 'active') || [],
    [dashboard],
  );

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-8 lg:px-8">
      <section className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-blue-700">
            <Layers3 className="size-3.5" />PRODUCT DECISION CENTER
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            每个产品，一套独立的增长判断系统
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            每个页面只读取该产品的 Doris 数据、Facebook 账户、达标标准和 Skill 规则，判断与实验不会跨产品混用。
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />刷新产品
        </Button>
      </section>

      {error ? <Alert variant="destructive" className="mt-5"><ShieldCheck className="size-4" /><AlertTitle>加载失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      <section className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {activeProducts.map((product: GrowthProduct) => {
          const judgments = dashboard?.judgments.filter((item) => item.productId === product.id) || [];
          const cases = dashboard?.cases.filter((item) => item.productId === product.id) || [];
          const pending = judgments.filter((item) => item.status === 'judgment_pending' || item.status === 'judgment_deferred').length;
          const fresh = Boolean(product.lastSyncAt) && Date.now() - new Date(product.lastSyncAt || 0).getTime() <= product.dataDelayMinutes * 2 * 60 * 1000;
          const calibrated = Object.keys(product.thresholds || {}).length > 0;
          const activeAccountCount = (product.adAccounts || []).filter(
            (account) =>
              account.activityStatus === 'active' ||
              account.activityStatus === 'new',
          ).length;
          const accountSummary = product.accountSyncAt
            ? `${activeAccountCount} 活跃 / ${product.accountIds.length} 已发现`
            : `${product.accountIds.length} 个账户（待动态同步）`;
          return <Link key={product.id} to={`/products/${product.id}`} className="group block">
            <Card className="h-full border-slate-200 bg-white shadow-none transition-all group-hover:-translate-y-0.5 group-hover:border-blue-300 group-hover:shadow-lg group-hover:shadow-blue-100/50">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-slate-950 text-lg font-semibold text-white">{product.name.slice(0, 1).toUpperCase()}</div>
                  <Badge variant="outline" className={fresh ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>{fresh ? 'Doris 已同步' : '等待同步'}</Badge>
                </div>
                <CardTitle className="pt-3 text-xl">{product.name}</CardTitle>
                <CardDescription>{product.channel.toUpperCase()} · {accountSummary}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <ProductFact icon={<Target className="size-3.5" />} label="产品目标" value={product.targetMetric.toUpperCase()} />
                  <ProductFact icon={<Database className="size-3.5" />} label="数据延迟" value={`${product.dataDelayMinutes} 分钟`} />
                  <ProductFact icon={<Clock3 className="size-3.5" />} label="待判断" value={`${pending} 条`} />
                  <ProductFact icon={<CheckCircle2 className="size-3.5" />} label="实验记录" value={`${cases.length} 条`} />
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                  <div><p className="text-xs font-medium text-slate-700">产品 Skill {product.skillVersion}</p><p className="mt-1 text-[11px] text-slate-400">{calibrated ? '产品标准已配置' : '产品标准待校准'}</p></div>
                  <span className="flex items-center gap-1 text-xs font-medium text-blue-700">进入产品页<ArrowRight className="size-3.5" /></span>
                </div>
              </CardContent>
            </Card>
          </Link>;
        })}
      </section>

      {!loading && activeProducts.length === 0 ? <div className="mt-7 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><Database className="mx-auto size-6 text-slate-400" /><p className="mt-3 text-sm font-medium text-slate-800">还没有产品页面</p><p className="mt-1 text-xs text-slate-500">接入产品后会自动生成独立页面和 Skill 入口。</p></div> : null}
    </div>
  );
};

const ProductFact: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => <div className="rounded-xl bg-slate-50 p-3"><span className="flex items-center gap-1.5 text-[11px] text-slate-500">{icon}{label}</span><p className="mt-2 text-sm font-semibold text-slate-900">{value}</p></div>;

export default ProductOverviewPage;
