import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Database,
  Download,
  RefreshCw,
  ArrowRight,
  CalendarDays,
} from 'lucide-react';
import { differenceInCalendarDays, format, subDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import axios from 'axios';
import { biRows } from '@shared/paid-growth';
import { verifiedNoSpend } from '@shared/campaign-visibility';
import { metaTargets } from '@shared/meta-targets';
import { BiCampaignDetail } from './BiCampaignDetail';
import { BiTrend } from './BiTrend';
import { biChannelSpend, biSummary } from '@shared/bi-summary';
import {
  paidGrowthQuickRange,
  shanghaiCalendarToday,
  type PaidGrowthPreset,
} from '@shared/paid-growth-dates';
import {
  biMetricSignal,
  type MetricStandardProduct,
} from '@shared/metric-signals';
import {
  BI_LEVELS,
  type BiDay,
  type BiLevel,
  type BiProduct,
  type BiRow,
} from '@shared/paid-growth.interface';
import { getBiDay, getBiProducts, syncBiProducts } from '@/api/paid-growth';
import type { MetaAdEntity } from '@shared/api.interface';
import { getMetaEntities } from '@/api/meta-operations';
import {
  CampaignMetaFilters,
  type MetaFilter,
  type MetaFilterItem,
} from './CampaignMetaFilters';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const number = (n: number | null, decimals = 2) =>
  n === null
    ? '—'
    : n.toLocaleString('zh-CN', { maximumFractionDigits: decimals });
const channelLabel = (channel: string) =>
  channel === 'facebook_web'
    ? 'Facebook Web'
    : channel === 'facebook'
      ? 'Facebook'
      : channel;
const BI_VIEW_LEVELS = (Object.keys(BI_LEVELS) as BiLevel[]).filter(
  (key) => key !== 'overall',
);
const errorText = (e: unknown) =>
  axios.isAxiosError(e)
    ? String(
        e.response?.data?.error?.message ||
          e.response?.data?.message ||
          e.message,
      )
    : e instanceof Error
      ? e.message
      : '请求失败';
const columns: Array<{ key: keyof BiRow; label: string; decimals?: number }> = [
  { key: 'spend', label: '消耗 ($)' },
  { key: 'impressions', label: '展示', decimals: 0 },
  { key: 'clicks', label: '点击', decimals: 0 },
  { key: 'ctr', label: 'CTR (%)' },
  { key: 'installs', label: 'Adjust 安装', decimals: 0 },
  { key: 'cpi', label: 'Adjust CPI ($)', decimals: 3 },
  { key: 'mediaInstalls', label: '媒体安装', decimals: 0 },
  { key: 'mediaCpi', label: '媒体 CPI ($)', decimals: 3 },
  { key: 'cpm', label: '买量 CPM ($)', decimals: 3 },
  { key: 'revenue', label: '当前 D0 收入 ($)' },
  { key: 'd0Roas', label: 'D0 收入 / 全部消耗 (%)' },
  { key: 'events', label: 'D0 收入事件数', decimals: 0 },
];
function DateRangeFilter({
  from,
  to,
  change,
}: {
  from: Date;
  to: Date;
  change: (range: { from: Date; to: Date }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>();
  const [rangeError, setRangeError] = useState('');
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(undefined);
          setRangeError('');
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label="日期范围"
          className="justify-start gap-2"
        >
          <CalendarDays className="size-4" />
          {format(from, 'yyyy-MM-dd')} ～ {format(to, 'yyyy-MM-dd')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] overflow-x-auto p-2">
        <p className="px-2 pt-1 text-xs text-slate-500">
          连续点击开始日期和结束日期；同一天可点两次
        </p>
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={draft}
          onSelect={(_next, clickedDate) => {
            setRangeError('');
            if (!draft?.from || draft.to) {
              setDraft({ from: clickedDate, to: undefined });
              return;
            }
            const from = clickedDate < draft.from ? clickedDate : draft.from;
            const to = clickedDate < draft.from ? draft.from : clickedDate;
            if (differenceInCalendarDays(to, from) > 30) {
              setRangeError('一次最多查询 31 天，请重新选择');
              setDraft({ from: clickedDate, to: undefined });
              return;
            }
            change({ from, to });
            setOpen(false);
          }}
          disabled={{ after: shanghaiCalendarToday() }}
        />
        {rangeError && (
          <p className="px-2 pb-1 text-xs text-red-600">{rangeError}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function PaidGrowthPage() {
  const [trendScope, setTrendScope] =
    useState<Parameters<typeof BiTrend>[0]['scope']>(null);
  const [expectedDates, setExpectedDates] = useState<string[]>([]);
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState<BiProduct[]>([]);
  const [standards, setStandards] = useState<MetricStandardProduct[]>([]);
  const [badOnly, setBadOnly] = useState(false);
  const [badFirst, setBadFirst] = useState(true);
  const refreshStandards = () =>
    axios
      .get<MetricStandardProduct[]>('/api/growth-decision/bi/standards')
      .then((r) => setStandards(r.data))
      .catch((e) => {
        setStandards([]);
        setError(`指标标准读取失败：${errorText(e)}`);
      });
  useEffect(() => {
    void refreshStandards();
    const refresh = () => {
      void refreshStandards();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const [appId, setAppId] = useState(params.get('appId') || '');
  const [media, setMedia] = useState(params.get('media') || '');
  const [start, setStart] = useState(shanghaiCalendarToday);
  const [end, setEnd] = useState(shanghaiCalendarToday);
  const [quickPreset, setQuickPreset] = useState<PaidGrowthPreset | null>(
    'today',
  );
  const [level, setLevel] = useState<BiLevel>('products');
  const [days, setDays] = useState<BiDay[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');
  const [warming, setWarming] = useState('');
  const [search, setSearch] = useState('');
  const [metaEntities, setMetaEntities] = useState<MetaAdEntity[]>([]);
  const [metaFilter, setMetaFilter] = useState<MetaFilter>(null);
  useEffect(() => {
    const refresh = () => {
      void getMetaEntities()
        .then(setMetaEntities)
        .catch((e) => setError(errorText(e)));
    };
    refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, []);
  const [selectedCampaign, setSelectedCampaign] = useState<BiRow | null>(null);
  const [sort, setSort] = useState<keyof BiRow>('spend');
  const [loadedScope, setLoadedScope] = useState('');
  const [loadedMedia, setLoadedMedia] = useState('');
  const controller = useRef<AbortController | null>(null);
  const availableMedia = useMemo(
    () =>
      [
        ...new Set(
          products
            .filter((p) => !appId || String(p.appId) === appId)
            .map((p) => p.channel),
        ),
      ].sort(),
    [products, appId],
  );
  const validSelection = !media || availableMedia.includes(media);
  const queryScope = `${format(start, 'yyyy-MM-dd')} ～ ${format(end, 'yyyy-MM-dd')} / ${appId} / ${media} / ${level}`;
  useEffect(() => {
    void getBiProducts()
      .then(setProducts)
      .catch((e) => setError(errorText(e)));
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!products.length) return;
    if (appId && !products.some((p) => String(p.appId) === appId)) {
      setAppId('');
      setMedia('');
    } else if (media && !availableMedia.includes(media)) setMedia('');
  }, [products, appId, media, availableMedia]);

  const load = async (
    refresh = false,
    requestedLevel: BiLevel = level,
    range = { from: start, to: end },
  ) => {
    if (!validSelection) {
      setError('所选渠道不在当前产品范围内');
      return;
    }
    const dayCount = differenceInCalendarDays(range.to, range.from) + 1;
    if (dayCount < 1 || dayCount > 31) {
      setError('请选择 1～31 天；大范围请分月查询。');
      return;
    }
    void refreshStandards();
    void getMetaEntities()
      .then(setMetaEntities)
      .catch((e) => setError(errorText(e)));
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setNotice('');
    setWarming('');
    setDays([]);
    setTrendScope((previous) => {
      const next = {
        start: format(range.from, 'yyyy-MM-dd'),
        end: format(range.to, 'yyyy-MM-dd'),
        appId,
        media,
        refresh,
        revision: Date.now(),
      };
      return !refresh &&
        previous &&
        previous.start === next.start &&
        previous.end === next.end &&
        previous.appId === next.appId &&
        previous.media === next.media
        ? previous
        : next;
    });
    setExpectedDates(
      Array.from({ length: dayCount }, (_, i) =>
        format(subDays(range.to, dayCount - i - 1), 'yyyy-MM-dd'),
      ),
    );
    setSelectedCampaign(null);
    setLoadedScope(
      `${format(range.from, 'yyyy-MM-dd')} ～ ${format(range.to, 'yyyy-MM-dd')} / ${appId} / ${media} / ${requestedLevel}`,
    );
    setLoadedMedia(media);
    setParams(
      { ...(appId ? { appId } : {}), ...(media ? { media } : {}) },
      { replace: true },
    );
    const next: BiDay[] = [];
    try {
      for (let i = 0; i < dayCount; i++) {
        const date = format(subDays(range.to, dayCount - i - 1), 'yyyy-MM-dd');
        setProgress(`读取 ${date} · ${i + 1}/${dayCount} 天`);
        try {
          next.push(
            await getBiDay(
              {
                date,
                level: requestedLevel,
                appId,
                media,
                refresh: refresh ? '1' : undefined,
              },
              abort.signal,
            ),
          );
        } catch (e) {
          if (abort.signal.aborted) throw e;
          const part = {
            state: 'missing' as const,
            rows: [],
            message: errorText(e),
          };
          next.push({
            date,
            level: requestedLevel,
            daily: part,
            revenue: part,
            events: part,
          });
        }
        if (!abort.signal.aborted) setDays([...next]);
      }
    } catch (e) {
      if (!abort.signal.aborted) setError(errorText(e));
    } finally {
      if (!abort.signal.aborted) {
        setBusy(false);
        setProgress('');
      }
    }
    // One background request at a time. Responses persist on the server, not in browser memory.
    for (const other of BI_VIEW_LEVELS) {
      if (other === requestedLevel || abort.signal.aborted) continue;
      // Broad queries only prefetch summaries; detailed dimensions stay on demand.
      if ((!appId || !media) && other !== 'products' && other !== 'channels')
        continue;
      for (let i = 0; i < dayCount; i++) {
        if (abort.signal.aborted) return;
        const date = format(subDays(range.to, dayCount - i - 1), 'yyyy-MM-dd');
        setWarming(`后台缓存：${BI_LEVELS[other]} · ${date}`);
        try {
          const warmed = await getBiDay(
            {
              date,
              level: other,
              appId,
              media,
              refresh: refresh ? '1' : undefined,
            },
            abort.signal,
          );
          if (
            [warmed.daily, warmed.revenue, warmed.events].some(
              (p) => p.state === 'missing' || p.state === 'stale',
            )
          ) {
            if (!abort.signal.aborted)
              setNotice(
                '部分维度预取失败，切换到该维度后将自动重试并展示具体原因。',
              );
          }
        } catch (e) {
          if (abort.signal.aborted) return;
          setNotice(`后台缓存未完成：${errorText(e)}；切换维度会自动重试。`);
        }
      }
    }
    if (!abort.signal.aborted)
      setWarming(
        appId && media
          ? '全部维度预取已结束；切换自动读取，缺口可重新拉取。'
          : '产品与渠道汇总已缓存；其他维度切换时按需读取。',
      );
  };
  const rows = useMemo(() => biRows(days), [days]);
  const summary = useMemo(() => biSummary(days), [days]);
  const trendStandards = standards.filter(
    (p) =>
      String(p.dorisAppId) === trendScope?.appId &&
      (!trendScope?.media ||
        p.channel.toLowerCase() === trendScope.media.toLowerCase()),
  );
  const trendTarget =
    trendStandards.length === 1
      ? trendStandards[0].metrics.find((m) => m.key === 'd0_roas')
          ?.standardValue
      : undefined;
  const noSpend = useMemo(
    () =>
      days[0]?.level === 'campaigns'
        ? verifiedNoSpend(days, expectedDates)
        : () => false,
    [days, expectedDates],
  );
  const hiddenCount = rows.filter(noSpend).length;
  const hasBad = (row: BiRow) =>
    columns.some((c) => biMetricSignal(row, c.key, standards).state === 'bad');
  const rowMeta = useMemo(() => {
    const result = new Map<string, MetaFilterItem>();
    for (const row of rows) {
      const entities = metaEntities.filter(
        (e) =>
          row.media.toLowerCase() === 'facebook' &&
          e.campaignId === row.campaignId,
      );
      // BI lacks account dimension: never combine metadata if ownership is ambiguous.
      const unique =
        new Set(entities.map((e) => e.accountId)).size === 1 ? entities : [];
      result.set(row.key, {
        metaObjectives: [
          ...new Set(unique.flatMap((e) => (e.objective ? [e.objective] : []))),
        ],
        metaOptimizationGoals: [
          ...new Set(
            unique.flatMap((e) =>
              e.optimizationGoal ? [e.optimizationGoal] : [],
            ),
          ),
        ],
        metaConversionEvents: metaTargets(unique).conversionEvents,
      });
    }
    return result;
  }, [rows, metaEntities]);
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => !noSpend(r))
        .filter((r) => !badOnly || hasBad(r))
        .filter(
          (r) =>
            level !== 'campaigns' ||
            !metaFilter ||
            (metaFilter.value === '__missing'
              ? !rowMeta.get(r.key)?.[metaFilter.key]?.length
              : rowMeta
                  .get(r.key)
                  ?.[metaFilter.key]?.includes(metaFilter.value)),
        )
        .filter((r) =>
          `${r.appName} ${r.media} ${r.label} ${r.campaignName || ''}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .sort(
          (a, b) =>
            (badFirst ? Number(hasBad(b)) - Number(hasBad(a)) : 0) ||
            Number(b[sort] ?? -1) - Number(a[sort] ?? -1),
        ),
    [
      noSpend,
      rows,
      search,
      sort,
      level,
      metaFilter,
      rowMeta,
      badOnly,
      badFirst,
      standards,
    ],
  );
  const issues = days.flatMap((day) =>
    (['daily', 'revenue', 'events'] as const).flatMap((key) =>
      day[key].message
        ? [
            `${day.date} · ${{ daily: '投放', revenue: 'D0 收入', events: 'D0 事件' }[key]}：${day[key].message}`,
          ]
        : [],
    ),
  );
  const total = (key: 'spend' | 'installs' | 'revenue') =>
    !rows.length || rows.some((r) => r[key] === null)
      ? null
      : rows.reduce((sum, r) => sum + (r[key] || 0), 0);
  const exportCsv = () => {
    const cell = (v: unknown) =>
      `"${String(v ?? '')
        .replace(/^[=+@-]/, "'$&")
        .replace(/"/g, '""')}"`;
    const csv = [
      [
        '产品',
        '渠道',
        '对象',
        ...columns.map((c) => c.label),
        '缺少指标的天数',
      ],
      ...filtered.map((r) => [
        r.appName,
        r.media,
        r.label,
        ...columns.map((c) => r[c.key]),
        r.missingDays,
      ]),
    ]
      .map((r) => r.map(cell).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(
      new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `paid-growth-${days[0]?.date}-${days.at(-1)?.date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="mx-auto max-w-[1540px] space-y-5 px-5 py-7 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-600">
            <Database className="size-4" />
            PAID GROWTH BI
          </p>
          <h1 className="text-2xl font-semibold">投放数据</h1>
          <p className="mt-2 text-sm text-slate-500">
            先看数据，再进入产品决策。共用 Doris
            与现有登录；此页只读，不修改广告。
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={syncing}>
              同步有投放的产品
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                将最近 30 天有消耗的产品接入决策中心？
              </AlertDialogTitle>
              <AlertDialogDescription>
                按 Doris 产品 ID
                和渠道分别建档，保留现有产品、规则及历史。不复制 Wingslite
                达标线；新产品需在指标库配置标准，再抓取决策快照。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setSyncing(true);
                  void syncBiProducts()
                    .then((p) => {
                      setProducts(p);
                      setNotice(
                        '产品已同步。新产品共用完整决策功能，请先配置各自指标标准。',
                      );
                    })
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setSyncing(false));
                }}
              >
                确认同步
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-xl bg-blue-50 p-4 text-sm text-blue-700"
        >
          {notice}
        </div>
      )}
      <section className="space-y-4 rounded-2xl border bg-white p-5">
        <p className="text-xs text-slate-500">
          展示 Doris 当前已入库数据，源头可能延迟；不是广告平台实时直连。
          {warming}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 space-y-1">
            <label className="block text-xs font-medium text-slate-500">
              产品（可选）
            </label>
            <Select
              value={appId || 'all'}
              onValueChange={(value) => {
                controller.current?.abort();
                const nextAppId = value === 'all' ? '' : value;
                setAppId(nextAppId);
                setMedia((current) =>
                  !current ||
                  products.some(
                    (product) =>
                      (!nextAppId || String(product.appId) === nextAppId) &&
                      product.channel === current,
                  )
                    ? current
                    : '',
                );
              }}
              disabled={busy}
            >
              <SelectTrigger aria-label="产品">
                <SelectValue placeholder="选择产品" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部产品</SelectItem>
                {[...new Map(products.map((p) => [p.appId, p])).values()].map(
                  (p) => (
                    <SelectItem key={p.appId} value={String(p.appId)}>
                      {p.name}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-40 space-y-1">
            <label className="block text-xs font-medium text-slate-500">
              渠道（可选）
            </label>
            <Select
              value={media || 'all'}
              onValueChange={(value) => {
                controller.current?.abort();
                setMedia(value === 'all' ? '' : value);
              }}
              disabled={busy}
            >
              <SelectTrigger aria-label="渠道">
                <SelectValue placeholder="选择渠道" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部渠道</SelectItem>
                {availableMedia.map((m) => (
                  <SelectItem key={m} value={m}>
                    {channelLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500">
              日期范围
            </label>
            <DateRangeFilter
              from={start}
              to={end}
              change={(range) => {
                controller.current?.abort();
                setStart(range.from);
                setEnd(range.to);
                setQuickPreset(null);
              }}
            />
          </div>
          <Button
            disabled={busy || !validSelection}
            onClick={() => void load()}
          >
            {busy ? '读取中…' : '查询数据'}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !validSelection}
            onClick={() => void load(true)}
          >
            <RefreshCw className="mr-2 size-4" />
            重新拉取
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-slate-500">快速查询</span>
          {(
            [
              ['today', '今天'],
              ['yesterday', '昨天'],
              ['thisWeek', '本周'],
              ['lastWeek', '上周'],
            ] as const
          ).map(([preset, label]) => (
            <Button
              key={preset}
              size="sm"
              variant={quickPreset === preset ? 'default' : 'outline'}
              aria-pressed={quickPreset === preset}
              disabled={busy || !validSelection}
              onClick={() => {
                const range = paidGrowthQuickRange(preset);
                setStart(range.from);
                setEnd(range.to);
                setQuickPreset(preset);
                void load(false, level, range);
              }}
            >
              {label}
            </Button>
          ))}
          {!validSelection && (
            <span className="text-xs text-slate-500">
              所选渠道不在当前产品范围内
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {BI_VIEW_LEVELS.map((key) => (
            <Button
              key={key}
              size="sm"
              disabled={busy || !validSelection}
              variant={level === key ? 'default' : 'ghost'}
              onClick={() => {
                setLevel(key);
                void load(false, key);
              }}
            >
              {BI_LEVELS[key]}
            </Button>
          ))}
          <span className="ml-auto self-center text-xs text-slate-500">
            切换维度自动查询 · 全产品或全渠道仅预取汇总 · 缓存 5 分钟 · 最多 31
            天
          </span>
        </div>
      </section>
      {level === 'campaigns' && (
        <CampaignMetaFilters
          items={[...rowMeta.values()]}
          value={metaFilter}
          onChange={(value) => {
            setMetaFilter(value);
          }}
        />
      )}
      {busy && (
        <p role="status" className="text-sm text-blue-600">
          {progress} · 按日串行读取，避免公司 Mac 和 Doris 过载
        </p>
      )}
      {loadedScope && loadedScope !== queryScope && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          筛选条件已变化，下方仍是上一次查询，请点击查询数据。
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            '消耗 ($)',
            loadedMedia ? biChannelSpend(days, loadedMedia) : summary.spend,
          ],
          ['Adjust 安装', total('installs')],
          ['当前 D0 收入 ($)', total('revenue')],
          ['当前 D0 ROAS (%)', summary.d0Roas],
        ].map(([label, value]) => (
          <section
            key={String(label)}
            className="rounded-2xl border bg-white p-5"
          >
            <p className="text-sm text-slate-500">
              {label === '消耗 ($)'
                ? `${label} · ${loadedMedia ? channelLabel(loadedMedia) : '全部渠道'}`
                : label}
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {number(value as number | null)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {busy
                ? '读取尚未完成，当前为已返回范围'
                : `${days.length} 天 · ${rows.length} 个对象`}
            </p>
          </section>
        ))}
      </div>
      <BiTrend
        scope={trendScope}
        target={trendTarget === undefined ? null : trendTarget * 100}
        wings={products.some(
          (p) =>
            String(p.appId) === trendScope?.appId &&
            /wings\s*lite/i.test(p.name),
        )}
      />
      {issues.length > 0 && (
        <details className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <summary className="cursor-pointer font-medium">
            {issues.length} 项数据提示 ·
            旧缓存、缺失与不支持维度不会伪装成完整数据
          </summary>
          <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </details>
      )}
      {days.length > 0 && (
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="mb-3 font-semibold">每日数据与完整性</h2>
          <div className="max-h-72 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>数据日</TableHead>
                  <TableHead>投放 / D0 收入 / 事件</TableHead>
                  <TableHead className="text-right">
                    消耗 ($) ·{' '}
                    {loadedMedia ? channelLabel(loadedMedia) : '全部渠道'}
                  </TableHead>
                  <TableHead className="text-right">Adjust 安装</TableHead>
                  <TableHead className="text-right">Adjust CPI ($)</TableHead>
                  <TableHead>最近获取</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...days].reverse().map((day) => {
                  const daily = biRows([day]);
                  const sum = (key: 'spend' | 'installs') =>
                    !daily.length || daily.some((r) => r[key] === null)
                      ? null
                      : daily.reduce((v, r) => v + (r[key] || 0), 0);
                  const spend = loadedMedia
                      ? biChannelSpend([day], loadedMedia)
                      : biSummary([day]).spend,
                    installs = sum('installs');
                  const states = {
                    fresh: '已更新',
                    cached: '缓存',
                    stale: '旧缓存',
                    missing: '失败',
                    unsupported: '不支持',
                  };
                  return (
                    <TableRow key={day.date}>
                      <TableCell className="whitespace-nowrap">
                        {day.date}
                      </TableCell>
                      <TableCell className="text-xs">
                        {[day.daily, day.revenue, day.events]
                          .map((p) => states[p.state])
                          .join(' / ')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {number(spend)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {number(installs, 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {number(
                          spend !== null && installs ? spend / installs : null,
                          3,
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">
                        {day.daily.updatedAt
                          ? new Date(day.daily.updatedAt).toLocaleString(
                              'zh-CN',
                            )
                          : '未获取'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
      <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-semibold">
              {BI_LEVELS[days[0]?.level || level]}明细
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {days[0]?.date || '尚未查询'}{' '}
              {days.length > 1 ? `～ ${days.at(-1)?.date}` : ''} ·{' '}
              {filtered.length} 条 · 横向滚动查看全部指标
              {hiddenCount > 0 &&
                ` · 已隐藏 ${hiddenCount} 个经校验无消耗的系列`}
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              aria-label="搜索明细"
              placeholder="搜索名称 / 系列 / 渠道"
              className="max-w-64"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
            <Button
              variant="outline"
              disabled={busy || !rows.length || issues.length > 0}
              onClick={exportCsv}
            >
              <Download className="mr-2 size-4" />
              CSV
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3 text-xs">
          <Button
            variant={badFirst ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setBadFirst(!badFirst);
            }}
          >
            不达标优先
          </Button>
          <Button
            variant={badOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setBadOnly(!badOnly);
            }}
          >
            仅看不达标（{rows.filter(hasBad).length}）
          </Button>
          <span className="text-red-700">红：未达产品标准</span>
          <span className="text-emerald-700">绿：达到标准（含等于）</span>
          <span className="text-slate-500">
            灰：未设标准/缺数。当前 D0
            为抓取时数据，非成熟结论；筛选仅影响明细。
          </span>
        </div>
        <div>
          <Table
            containerClassName="max-h-[65vh] overflow-auto"
            className="border-separate border-spacing-0"
          >
            <TableHeader className="sticky top-0 z-30 bg-slate-50">
              <TableRow>
                <TableHead className="sticky left-0 z-20 min-w-72 bg-slate-50">
                  对象 / 产品 / 渠道
                </TableHead>
                {columns.map((c) => (
                  <TableHead
                    key={c.key}
                    className="whitespace-nowrap text-right"
                  >
                    <button className="py-3" onClick={() => setSort(c.key)}>
                      {c.label}
                      {sort === c.key ? ' ↓' : ''}
                    </button>
                  </TableHead>
                ))}
                <TableHead className="min-w-32">决策入口</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => {
                const product = products.find(
                  (p) => p.appId === row.appId && p.channel === row.media,
                );
                return (
                  <TableRow
                    key={row.key}
                    className={hasBad(row) ? 'bg-red-50/40' : ''}
                  >
                    <TableCell
                      className={`sticky left-0 z-10 min-w-72 max-w-96 border-r ${hasBad(row) ? 'bg-red-50' : 'bg-white'}`}
                    >
                      {row.campaignId && days[0]?.level === 'campaigns' ? (
                        <button
                          className="max-w-96 whitespace-normal break-words text-left font-medium text-blue-700 hover:underline"
                          onClick={() => setSelectedCampaign(row)}
                        >
                          {row.label}
                        </button>
                      ) : (
                        <p className="max-w-96 whitespace-normal break-words font-medium">
                          {level === 'channels'
                            ? channelLabel(row.label)
                            : row.label}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        {row.appName} · {channelLabel(row.media)}
                      </p>
                      {row.campaignName && row.campaignName !== row.label && (
                        <button
                          onClick={() => setSelectedCampaign(row)}
                          className="block max-w-96 whitespace-normal break-words text-left text-xs text-blue-600 hover:underline"
                        >
                          {row.campaignName}
                        </button>
                      )}
                      {row.missingDays > 0 && (
                        <Badge
                          variant="outline"
                          className="mt-2 text-amber-700"
                        >
                          {row.spend === null
                            ? '投放数据未返回'
                            : level === 'adgroups'
                              ? '广告组不支持 D0'
                              : '当前 D0 未返回'}
                        </Badge>
                      )}
                    </TableCell>
                    {columns.map((c) => {
                      const signal = biMetricSignal(row, c.key, standards);
                      return (
                        <TableCell
                          key={c.key}
                          title={signal.label}
                          className={`whitespace-nowrap text-right tabular-nums ${signal.state === 'bad' ? 'bg-red-50 font-semibold text-red-700' : signal.state === 'good' ? 'bg-emerald-50 font-semibold text-emerald-700' : ''}`}
                        >
                          {number(row[c.key] as number | null, c.decimals)}
                          {signal.state !== 'unknown' && (
                            <span className="block text-[10px] font-normal">
                              {signal.label}
                            </span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      {product?.productId ? (
                        <Link
                          className="inline-flex items-center gap-1 whitespace-nowrap text-blue-600"
                          to={`/products/${product.productId}${row.campaignId ? `?campaignId=${encodeURIComponent(row.campaignId)}` : ''}`}
                        >
                          进入决策中心
                          <ArrowRight className="size-3" />
                        </Link>
                      ) : level === 'products' ? (
                        <span className="text-xs text-slate-400">
                          请切换到渠道或系列维度
                        </span>
                      ) : level === 'channels' && !appId ? (
                        <span className="text-xs text-slate-400">
                          选择产品后查看决策
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">
                          请先同步产品
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filtered.length && (
                <TableRow>
                  <TableCell
                    colSpan={14}
                    className="py-14 text-center text-slate-500"
                  >
                    {busy
                      ? '正在读取 Doris…'
                      : days.length
                        ? '当前范围无可显示记录；请检查上方查询状态，空结果不等于零消耗。'
                        : '选择产品、日期和查看维度后，点击“查询数据”。'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t p-3 text-xs text-slate-500">
          <span>
            全部 {filtered.length} 条 · 无需翻页 · 表头与首列固定 ·
            点击广告系列查看归属和趋势
          </span>
        </div>
      </section>
      {selectedCampaign && (
        <BiCampaignDetail
          key={`${selectedCampaign.appId}:${selectedCampaign.media}:${selectedCampaign.campaignId}`}
          row={selectedCampaign}
          entities={metaEntities}
          endDate={days.at(-1)?.date || format(end, 'yyyy-MM-dd')}
          productId={
            products.find(
              (p) =>
                p.appId === selectedCampaign.appId &&
                p.channel === selectedCampaign.media,
            )?.productId
          }
          onClose={() => setSelectedCampaign(null)}
        />
      )}
      <details className="rounded-xl border bg-white p-4 text-sm text-slate-600">
        <summary className="cursor-pointer font-medium">
          指标口径与决策页的关系
        </summary>
        <div className="mt-3 space-y-2">
          <p>
            Adjust CPI = 消耗 / Adjust 安装，与决策页一致。媒体 CPI
            单独展示，不能混用。买量 CPM = 消耗 / 展示 × 1000，不是产品变现
            eCPM。
          </p>
          <p>
            本页 D0 = 查询时已入库 D0 收入 /
            全部媒体消耗（含未完成观察期的数据）；决策页 cohort D0 可能使用匹配
            cohort 消耗，分母不同，不应直接判定为数据错误。今日
            数据可能继续回补，不用于直接判定达标。未返回保持空值，不当作零。
          </p>
          <p>
            收入事件数不是付费人数；广告组不具备 cohort 归因，故不展示推算
            D0。CPA、次留、IPU 和变现 eCPM
            需独立可靠数据源，不能从现有字段强行计算。
          </p>
          <p>
            此页查询缓存不会替代决策快照。进入产品页按原流程抓取、分析、人工确认；不同产品不共享达标线。
          </p>
        </div>
      </details>
    </div>
  );
}
