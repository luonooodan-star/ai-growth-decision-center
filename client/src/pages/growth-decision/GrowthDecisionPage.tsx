import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  ArrowLeft,
  Database,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { GrowthProduct } from '@shared/api.interface';
import { growthDecision } from '@/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CampaignDecisionBoard } from './CampaignDecisionBoard';
import { FetchHistoryControl } from './FetchHistoryControl';

const GrowthDecisionPage: React.FC = () => {
  const { productId = '' } = useParams<{ productId: string }>();
  const [product, setProduct] = useState<GrowthProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refreshedAt, setRefreshedAt] = useState('');
  const loadDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const dashboard = await growthDecision.getDashboard();
      setProduct(dashboard.products.find((p) => p.id === productId) || null);
      setLoaded(true);
      setRefreshedAt(new Date().toISOString());
    } catch (e: unknown) {
      setError(
        axios.isAxiosError(e)
          ? String(e.response?.data?.message || e.message)
          : e instanceof Error
            ? e.message
            : '工作台加载失败',
      );
    } finally {
      setLoading(false);
    }
  }, [productId]);
  useEffect(() => {
    setProduct(null);
    setLoaded(false);
    void loadDashboard();
  }, [loadDashboard]);

  if (loading && !loaded)
    return (
      <div className="flex min-h-[70vh] items-center justify-center gap-3 text-sm text-slate-500">
        <RefreshCw className="size-4 animate-spin" />
        正在加载广告系列决策台
      </div>
    );
  if (loaded && !product)
    return (
      <div className="mx-auto max-w-3xl px-5 py-20 text-center">
        <Database className="mx-auto size-7 text-slate-400" />
        <h1 className="mt-4 text-xl font-semibold">产品页面不存在</h1>
        <Button asChild variant="outline" className="mt-5">
          <Link to="/">返回产品中心</Link>
        </Button>
      </div>
    );

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
            {product?.name.toUpperCase()} · PRODUCT DECISION PAGE
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 lg:text-3xl">
            {product?.name} 广告系列决策
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            统一按系列判断、分析、执行与复查。历史实验记录保留在实验库，产品达标线在指标库管理。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">公司 Mac 局域网服务</Badge>
          <FetchHistoryControl
            productId={productId}
            onCompleted={loadDashboard}
            onError={setError}
          />
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void loadDashboard()}
          >
            <RefreshCw className="size-4" />
            刷新
          </Button>
        </div>
      </section>
      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertTriangle className="size-4" />
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {product && (
        <CampaignDecisionBoard
          key={productId}
          productId={productId}
          refreshedAt={refreshedAt}
          onChanged={loadDashboard}
        />
      )}
    </div>
  );
};

export default GrowthDecisionPage;
