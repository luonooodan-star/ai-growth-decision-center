import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getBiProducts, getBiStandards } from '@/api/paid-growth';
import type { BiProduct } from '@shared/paid-growth.interface';
import type { MetricStandardProduct } from '@shared/metric-signals';
import {
  adjustmentAccounts,
  adjustmentDates,
  adjustmentSignal,
  adjustmentReportedTotal,
  adjustmentTree,
  emptyAdjustmentMetrics,
} from '@shared/ad-adjustment';
import { useAdjustmentData } from './useAdjustmentData';
import { MetaExecutionWorkspace } from './MetaExecutionWorkspace';
import {
  AdAdjustmentTable,
  adjustmentCount,
  adjustmentMoney,
  adjustmentPct,
} from './AdAdjustmentTable';

const panel = 'rounded-xl border border-slate-200 bg-white';
const formatTime = (stamp: string | number) =>
  new Date(stamp).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Select
      value={value || '__all__'}
      onValueChange={(v) => onChange(v === '__all__' ? '' : v)}
    >
      <SelectTrigger aria-label={label} className="w-full min-w-40 bg-white">
        <SelectValue placeholder={`全部${label}`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">全部{label}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export default function AdAdjustmentPage() {
  const [products, setProducts] = useState<BiProduct[]>([]);
  const [standards, setStandards] = useState<MetricStandardProduct[]>([]);
  const [setupError, setSetupError] = useState('');
  const [metadataRevision, setMetadataRevision] = useState(0);
  const [appId, setAppId] = useState(''),
    [media, setMedia] = useState('');
  const [search, setSearch] = useState(''),
    [account, setAccount] = useState('');
  const [optimizer, setOptimizer] = useState(''),
    [country, setCountry] = useState('');
  const [status, setStatus] = useState('all');
  const { days, today, loading, error, progress, nextAt, refresh } =
    useAdjustmentData(appId, media);
  useEffect(() => {
    let live = true;
    setSetupError('');
    void Promise.all([getBiProducts(), getBiStandards()])
      .then(([p, s]) => {
        if (live) {
          setProducts(p);
          setStandards(s);
        }
      })
      .catch((e) => {
        if (live)
          setSetupError(
            `筛选项或指标标准读取失败：${e instanceof Error ? e.message : '请重试'}`,
          );
      });
    return () => {
      live = false;
    };
  }, [metadataRevision]);
  useEffect(() => {
    setAccount('');
    setOptimizer('');
    setCountry('');
  }, [appId, media]);
  const dates = adjustmentDates(today);
  const current = days.find((d) => d.date === today);
  const options = useMemo(() => {
    const rows = current
      ? [...current.daily.rows, ...current.revenue.rows]
      : [];
    const resolve = adjustmentAccounts(days);
    const values = (get: (r: (typeof rows)[number]) => string) =>
      [...new Set(rows.map(get))]
        .sort()
        .map((value) => ({ value, label: value }));
    return {
      accounts: values(resolve),
      optimizers: values((r) => String(r.buyer_alias || '未返回')),
      countries: values((r) => String(r.country_code || '未返回')),
    };
  }, [days, current]);
  const tree = useMemo(
    () => adjustmentTree(days, { search, account, optimizer, country }, today),
    [days, search, account, optimizer, country, today],
  );
  const nodes = tree.filter(
    (n) =>
      status === 'all' ||
      adjustmentSignal(n, today, standards).state === status,
  );
  const total = tree.length
    ? adjustmentReportedTotal(tree.map((n) => n.days[today]))
    : emptyAdjustmentMetrics();
  const qualifiedSpend = tree
    .filter((n) => adjustmentSignal(n, today, standards).state === 'good')
    .reduce((sum, n) => sum + (n.days[today].spend || 0), 0);
  const issues = [
    ...new Set(
      days.flatMap((d) =>
        [d.daily, d.revenue, d.accounts]
          .filter((p) => p.state === 'missing' || p.state === 'stale')
          .map((p) => `${d.date}：${p.message || '数据未返回'}`),
      ),
    ),
  ];
  const timestamps = days
    .flatMap((d) => [d.daily, d.revenue])
    .map((p) => p.updatedAt)
    .filter((s): s is string => !!s);
  const appOptions = [
    ...new Map(
      products.map((p) => [
        String(p.appId),
        { value: String(p.appId), label: p.name },
      ]),
    ).values(),
  ];
  const mediaOptions = [
    ...new Set(
      products
        .filter((p) => !appId || String(p.appId) === appId)
        .map((p) => p.channel),
    ),
  ]
    .sort()
    .map((value) => ({ value, label: value }));
  const cards = [
    [
      '媒体消耗',
      adjustmentMoney(total.spend),
      `${tree.length} 个系列 · 以下搜索与筛选后的汇总`,
    ],
    [
      'D0 收入',
      adjustmentMoney(total.revenue),
      '安装 cohort 第 0 天已返回收入；单个缺失系列不补零',
    ],
    ['D0 ROAS', adjustmentPct(total.roas), 'D0 收入 / 当天消耗'],
    ['eCPM', '—', '变现 eCPM 尚无系列级归因，不以买量 CPM 替代'],
    [
      '达标消耗占比',
      adjustmentPct(
        total.spend != null &&
          total.spend > 0 &&
          tree.some(
            (n) => adjustmentSignal(n, today, standards).standard !== undefined,
          )
          ? (qualifiedSpend / total.spend) * 100
          : null,
      ),
      '达标消耗 / 全部消耗；缺数不视为达标',
    ],
    ['CPM', adjustmentMoney(total.cpm), '消耗 / 媒体展示 × 1000'],
    ['CPI', adjustmentMoney(total.cpi), '消耗 / 媒体安装'],
    ['CTR', adjustmentPct(total.ctr), '媒体点击 / 媒体展示'],
    ['安装 CVR', adjustmentPct(total.cvr), '媒体安装 / 媒体点击'],
  ];
  return (
    <div className="mx-auto max-w-[1920px] space-y-5 px-4 py-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-slate-400">
            PERFORMANCE WORKSPACE
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            广告调整 · 把每一分消耗，看清楚。
          </h1>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>上海时区 · 今日 {today}</p>
          <p className="mt-1">
            {timestamps.length
              ? `数据最早抓取于 ${formatTime([...timestamps].sort()[0])}`
              : '等待读取数据'}
          </p>
          <p className="mt-1">
            页面开启时每 4 小时自动刷新
            {nextAt ? ` · 下次 ${formatTime(nextAt)}` : ''}
          </p>
        </div>
      </header>
      <MetaExecutionWorkspace />
      <section
        className={`${panel} flex flex-wrap items-end justify-between gap-4 p-4`}
      >
        <div className="grid w-full gap-4 sm:w-auto sm:grid-cols-2">
          <div className="min-w-52 space-y-2">
            <p className="text-xs text-slate-500">产品</p>
            <FilterSelect
              label="产品"
              value={appId}
              options={appOptions}
              onChange={(v) => {
                setAppId(v);
                setMedia('');
              }}
            />
          </div>
          <div className="min-w-52 space-y-2">
            <p className="text-xs text-slate-500">渠道</p>
            <FilterSelect
              label="渠道"
              value={media}
              options={mediaOptions}
              onChange={setMedia}
            />
          </div>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => {
            setMetadataRevision((v) => v + 1);
            void refresh();
          }}
        >
          <RefreshCw
            className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`}
          />
          {loading ? '刷新中' : '刷新数据'}
        </Button>
      </section>
      {(error || setupError || issues.length > 0) && (
        <div
          role="alert"
          className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p>
            {error ||
              setupError ||
              '部分数据缺失或为旧缓存，暂不据此调整投放。'}
          </p>
          {issues.length > 0 && (
            <details>
              <summary className="cursor-pointer">
                查看 {issues.length} 项数据提示
              </summary>
              {issues.map((i) => (
                <p key={i} className="mt-1 break-words">
                  {i}
                </p>
              ))}
            </details>
          )}
        </div>
      )}
      <div aria-live="polite" className="text-xs text-slate-500">
        {loading
          ? progress
          : '仅展示今天的经营数据；前天、昨天仅用于 D0 ROAS 对照。今日数据仍在回传。'}
      </div>
      <section>
        <h2 className="mb-3 text-lg font-semibold">
          {appOptions.find((o) => o.value === appId)?.label || '全部产品'} ·{' '}
          {media || '全部渠道'}
        </h2>
        <div
          data-ai-section-type="card-stat"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          {cards.map(([title, value, hint]) => (
            <div
              key={title}
              className={`${panel} p-5 ${title === 'D0 ROAS' ? 'border-t-4 border-t-blue-600' : ''}`}
            >
              <p className="text-sm text-slate-500">{title}</p>
              <p className="my-3 text-2xl font-bold tabular-nums">{value}</p>
              <p className="text-xs leading-relaxed text-slate-400">{hint}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
          媒体安装{' '}
          <strong className="ml-2">{adjustmentCount(total.installs)}</strong>
        </p>
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.2em] text-slate-400">
              CAMPAIGN PERFORMANCE
            </p>
            <h2 className="mt-1 text-xl font-bold">系列经营表现</h2>
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {[
              ['all', '全部'],
              ['good', '达标'],
              ['bad', '未达标'],
            ].map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={status === key ? 'default' : 'ghost'}
                onClick={() => setStatus(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <div className={`${panel} overflow-hidden`}>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_auto]">
            <Input
              aria-label="搜索广告系列名称或 ID"
              placeholder="搜索广告系列名称或 ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <FilterSelect
              label="广告账户"
              value={account}
              options={options.accounts}
              onChange={setAccount}
            />
            <FilterSelect
              label="优化师"
              value={optimizer}
              options={options.optimizers}
              onChange={setOptimizer}
            />
            <FilterSelect
              label="国家"
              value={country}
              options={options.countries}
              onChange={setCountry}
            />
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('');
                setAccount('');
                setOptimizer('');
                setCountry('');
                setStatus('all');
              }}
            >
              <SlidersHorizontal className="mr-2 size-4" />
              清除筛选
            </Button>
          </div>
          <p className="px-4 pb-3 text-xs text-slate-500">
            搜索、账户、优化师、国家同时满足（AND）。国家/人员筛选会重算当前切片指标。达标按今天
            D0 与指标库标准判断；未返回或未配置标准仅列在“全部”。
          </p>
          <AdAdjustmentTable
            nodes={nodes}
            dates={dates}
            today={today}
            standards={standards}
          />
        </div>
      </section>
    </div>
  );
}
