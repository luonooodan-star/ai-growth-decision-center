import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableFilter as FilterSelect } from './SearchableFilter';
import { useAccountNames } from './useAccountNames';
import {
  getBiChannelSpend,
  getBiProducts,
  getBiStandards,
} from '@/api/paid-growth';
import type { BiPart, BiProduct } from '@shared/paid-growth.interface';
import { biPartChannelSpend } from '@shared/bi-summary';
import type { MetricStandardProduct } from '@shared/metric-signals';
import {
  adjustmentAccounts,
  adjustmentMatches,
  adjustmentDates,
  adjustmentSignal,
  adjustmentReportedTotal,
  adjustmentTree,
  withAdjustmentDetails,
  emptyAdjustmentMetrics,
} from '@shared/ad-adjustment';
import { useAdjustmentData } from './useAdjustmentData';
import { verifiedNoSpend } from '@shared/campaign-visibility';
import { AdjustmentSubmitPanel, useAdjustmentDrafts } from './AdjustmentEditor';
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
export default function AdAdjustmentPage() {
  const draftState = useAdjustmentDrafts();
  const [products, setProducts] = useState<BiProduct[]>([]);
  const [standards, setStandards] = useState<MetricStandardProduct[]>([]);
  const [setupError, setSetupError] = useState('');
  const [channelSpend, setChannelSpend] = useState<{
    appId: string;
    part: BiPart;
  }>();
  const [channelSpendError, setChannelSpendError] = useState('');
  const channelSpendRequest = useRef<AbortController | null>(null);
  const [metadataRevision, setMetadataRevision] = useState(0);
  const [appId, setAppId] = useState(''),
    [media, setMedia] = useState('');
  const [search, setSearch] = useState(''),
    [account, setAccount] = useState('');
  const [optimizer, setOptimizer] = useState(''),
    [country, setCountry] = useState('');
  const [status, setStatus] = useState('all');
  const {
    days,
    today,
    loading,
    error,
    progress,
    refresh,
    cancel,
    details,
    loadDetail,
    options: filterData,
    accountsReady,
  } = useAdjustmentData(appId, media);
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
  useEffect(() => {
    channelSpendRequest.current?.abort();
    setChannelSpend(undefined);
    setChannelSpendError('');
    return () => channelSpendRequest.current?.abort();
  }, [appId]);
  const loadChannelSpend = async () => {
    if (!appId) return;
    channelSpendRequest.current?.abort();
    const controller = new AbortController();
    channelSpendRequest.current = controller;
    setChannelSpendError('');
    try {
      const part = await getBiChannelSpend(today, appId, controller.signal);
      if (!controller.signal.aborted) setChannelSpend({ appId, part });
    } catch (error) {
      if (!controller.signal.aborted)
        setChannelSpendError(
          error instanceof Error ? error.message : '渠道消耗读取失败',
        );
    }
  };
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
      optimizers: [
        ...new Set(
          (filterData?.rows || [])
            .map((r) => String(r.buyer_alias || ''))
            .filter(Boolean),
        ),
      ]
        .sort()
        .map((value) => ({ value, label: value })),
      countries: [
        ...new Set(
          (filterData?.rows || [])
            .map((r) => String(r.country_code || ''))
            .filter(Boolean),
        ),
      ]
        .sort()
        .map((value) => ({ value, label: value })),
    };
  }, [days, current, filterData]);
  const { names: accountNames, pending: accountNamesPending } = useAccountNames(
    options.accounts.map((option) => option.value),
    metadataRevision,
  );
  const tree = useMemo(
    () =>
      withAdjustmentDetails(
        adjustmentTree(days, { search, account, optimizer, country }, today),
        Object.fromEntries(
          Object.entries(details).map(([id, detail]) => [id, detail.days]),
        ),
        { search, account, optimizer, country },
        today,
      ),
    [days, details, search, account, optimizer, country, today],
  );
  const noSpend = useMemo(
    () =>
      verifiedNoSpend(
        days
          .filter(
            (d) =>
              d.filterable ||
              (d.scope?.optimizer === optimizer &&
                d.scope?.country === country),
          )
          .map((d) =>
            d.filterable
              ? {
                  ...d,
                  daily: {
                    ...d.daily,
                    rows: d.daily.rows.filter((row) =>
                      adjustmentMatches(
                        row,
                        { search: '', account: '', optimizer, country },
                        '',
                      ),
                    ),
                  },
                }
              : d,
          ),
        [today],
      ),
    [days, today, optimizer, country],
  );
  const hiddenCount = tree.filter(noSpend).length;
  const nodes = tree
    .filter((n) => !noSpend(n))
    .filter(
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
          .filter(
            (p) =>
              p.state === 'missing' ||
              p.state === 'stale' ||
              p.message?.includes('已排除'),
          )
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
    .map((value) => ({
      value,
      label:
        value === 'facebook_web'
          ? 'Facebook Web'
          : value === 'facebook'
            ? 'Facebook'
            : value,
    }));
  const mediaLabel = mediaOptions.find(
    (option) => option.value === media,
  )?.label;
  const cards = [
    [
      mediaLabel ? `${mediaLabel} 消耗` : '媒体消耗',
      adjustmentMoney(total.spend),
      `${tree.length} 个系列 · 仅统计所选渠道，以下搜索与筛选后的汇总`,
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
          <p className="mt-1">选定产品和渠道后手动抓取，不自动刷新</p>
        </div>
      </header>
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
        {loading && (
          <Button variant="ghost" onClick={cancel}>
            停止等待
          </Button>
        )}
        <Button
          variant="outline"
          disabled={loading || !appId || !media}
          onClick={() => {
            void refresh();
            void loadChannelSpend();
          }}
        >
          <RefreshCw
            className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`}
          />
          {loading ? '后台更新中（保留已显示数据）' : '抓取数据'}
        </Button>
      </section>
      {(!appId || !media) && (
        <p className="text-sm text-slate-500">
          请先选择一个产品和渠道，再点击“抓取数据”。
        </p>
      )}
      {setupError && (
        <Button
          variant="outline"
          onClick={() => setMetadataRevision((v) => v + 1)}
        >
          重试加载产品与渠道
        </Button>
      )}
      {draftState.error && (
        <p role="alert" className="text-red-700">
          {draftState.error}
        </p>
      )}
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
        {progress ||
          '仅展示今天的经营数据；前天、昨天仅用于 D0 ROAS 对照。今日数据仍在回传。'}
      </div>
      {current && (
        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          {(['daily', 'revenue', 'accounts'] as const).map((part, i) => (
            <span key={part}>
              {['今日消耗', '今日 D0', '账户归属'][i]}：{current[part].state}
              {current[part].updatedAt
                ? ` · ${formatTime(current[part].updatedAt!)}`
                : ' · 等待返回'}
              {current.timings?.[part] != null
                ? ` · 本次 ${(current.timings[part] / 1000).toFixed(1)} 秒`
                : ''}
            </span>
          ))}
        </div>
      )}
      <section>
        <h2 className="mb-3 text-lg font-semibold">
          {appOptions.find((o) => o.value === appId)?.label || '全部产品'} ·{' '}
          {mediaLabel || '未选择渠道'}
        </h2>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          {(['facebook', 'facebook_web'] as const).map((channel) => {
            const part =
              channelSpend?.appId === appId ? channelSpend.part : undefined;
            return (
              <div key={channel} className={`${panel} p-4`}>
                <p className="text-sm text-slate-500">
                  {channel === 'facebook' ? 'Facebook' : 'Facebook Web'} 消耗 ·
                  今日
                </p>
                <p className="mt-2 text-xl font-semibold tabular-nums">
                  {adjustmentMoney(biPartChannelSpend(part, channel))}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  产品全量 · 不受下方系列筛选影响
                  {part?.updatedAt ? ` · ${formatTime(part.updatedAt)}` : ''}
                </p>
              </div>
            );
          })}
        </div>
        {channelSpendError && (
          <p role="alert" className="mb-3 text-sm text-red-700">
            渠道消耗读取失败：{channelSpendError}
          </p>
        )}
        {channelSpend &&
          !['fresh', 'cached'].includes(channelSpend.part.state) && (
            <p className="mb-3 text-sm text-amber-800">
              渠道消耗未完整返回，请重新抓取；旧值不用于汇总。
              {channelSpend.part.message ? ` ${channelSpend.part.message}` : ''}
            </p>
          )}
        {channelSpend?.part.message?.includes('已排除') && (
          <p className="mb-3 text-sm text-amber-800">
            {channelSpend.part.message}
          </p>
        )}
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
              options={options.accounts.map((option) =>
                /^\d+$/.test(option.value)
                  ? {
                      value: option.value,
                      label:
                        accountNames[option.value] ||
                        (accountNamesPending
                          ? '账户名称读取中'
                          : '账户名称未返回'),
                      description: option.value,
                    }
                  : option,
              )}
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
            {hiddenCount > 0 &&
              `已隐藏 ${hiddenCount} 个经校验今日无消耗的系列。`}
            搜索、账户、优化师、国家同时满足（AND）。国家/人员筛选会重算当前切片指标。达标按今天
            D0 与指标库标准判断；未返回或未配置标准仅列在“全部”。
          </p>
          <AdAdjustmentTable
            accountsReady={accountsReady}
            details={details}
            loadDetail={loadDetail}
            drafts={draftState.drafts}
            updateDraft={draftState.update}
            nodes={nodes}
            dates={dates}
            today={today}
            standards={standards}
          />
        </div>
      </section>
      <AdjustmentSubmitPanel
        blockedReason={
          accountsReady ? '' : '账户归属尚未完成本次核验，暂不可提交广告修改'
        }
        drafts={draftState.drafts}
        update={draftState.update}
      />
    </div>
  );
}
