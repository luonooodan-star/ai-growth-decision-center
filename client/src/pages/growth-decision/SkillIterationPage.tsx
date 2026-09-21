import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import type { GrowthProduct } from '@shared/api.interface';
import { growthDecision } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WeeklySkillReviews } from './WeeklySkillReviews';

export default function SkillIterationPage() {
  const [products, setProducts] = useState<GrowthProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    try {
      setProducts((await growthDecision.getDashboard()).products);
      setError('');
    } catch {
      setError('产品 Skill 加载失败，请刷新重试');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="mx-auto max-w-[1380px] px-5 py-8 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-violet-700">
            <Sparkles className="size-4" /> SKILL ITERATION
          </div>
          <h1 className="text-3xl font-semibold text-slate-950">
            产品 Skill 迭代
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            广告调整页执行记录与当时快照 → Doris 后续结果 → Codex 周复盘 →
            审核入库。 不再依赖 Meta MCP 抓取操作日志；历史导入记录继续保留。
            无需登记实验或手工编辑候选规则。
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className="size-4" />
          刷新知识
        </Button>
      </header>
      {error && (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      )}
      <WeeklySkillReviews onUpdated={load} />
      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        {products.map((product) => (
          <Card
            key={product.id}
            className="border-slate-200 bg-white shadow-none"
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{product.name}</CardTitle>
                  <p className="mt-1 break-all text-xs text-slate-500">
                    当前 Skill：{product.skillVersion}
                  </p>
                </div>
                <Badge variant="secondary">
                  已审核知识 {product.knowledge?.length || 0} 条
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-80 space-y-3 overflow-y-auto">
                {product.knowledge?.map((k) => (
                  <article key={k.id} className="rounded-xl border p-3 text-sm">
                    <p className="font-medium">{k.conclusion}</p>
                    <p className="mt-2 text-amber-800">适用限制：{k.caution}</p>
                    <p className="mt-2 break-all text-xs text-slate-500">
                      来源 {k.sourceCaseId} · 审核于{' '}
                      {new Date(k.approvedAt).toLocaleString('zh-CN')}
                    </p>
                  </article>
                ))}
                {!product.knowledge?.length && (
                  <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">
                    暂无已审核知识。系统将从实际操作与后续结果积累证据，周复盘完成后在上方审核。
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
