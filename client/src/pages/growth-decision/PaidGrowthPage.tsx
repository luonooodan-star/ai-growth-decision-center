import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Database,
  Download,
  RefreshCw,
  ArrowRight,
  CalendarDays,
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import axios from 'axios';
import { biRows } from '@shared/paid-growth';
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
function DateFilter({
  label,
  value,
  change,
}: {
  label: string;
  value: Date;
  change: (date: Date) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-start gap-2">
          <CalendarDays className="size-4" />
          <span className="text-slate-500">{label}</span>
          {format(value, 'yyyy-MM-dd')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => date && change(date)}
          disabled={{ after: new Date() }}
        />
      </PopoverContent>
    </Popover>
  );
}

export default function PaidGrowthPage() {
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
  const [appId, setAppId] = useState(params.get('appId') || 'all');
  const [media, setMedia] = useState(params.get('media') || 'all');
  const [start, setStart] = useState(new Date());
  const [end, setEnd] = useState(new Date());
  const [level, setLevel] = useState<BiLevel>('overall');
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
    const refresh = () => { void getMetaEntities()
      .then(setMetaEntities)
      .catch((e) => setError(errorText(e))); };
    refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, []);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<keyof BiRow>('spend');
  const [loadedScope, setLoadedScope] = useState('');
  const controller = useRef<AbortController | null>(null);
  const queryScope = `${format(start, 'yyyy-MM-dd')} ～ ${format(end, 'yyyy-MM-dd')} / ${appId} / ${media} / ${level}`;
  useEffect(() => {
    void getBiProducts()
      .then(setProducts)
      .catch((e) => setError(errorText(e)));
    return () => controller.current?.abort();
  }, []);

  const load = async (refresh = false, requestedLevel: BiLevel = level) => {
    void refreshStandards();
    void getMetaEntities().then(setMetaEntities).catch(e => setError(errorText(e)));
    const dayCount =
      Math.round(
        (Date.parse(format(end, 'yyyy-MM-dd')) -
          Date.parse(format(start, 'yyyy-MM-dd'))) /
          86400000,
      ) + 1;
    if (dayCount < 1 || dayCount > 31) {
      setError('请选择 1～31 天；大范围请分月查询。');
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setNotice('');
    setWarming('');
    setDays([]);
    setPage(0);
    setLoadedScope(
      `${format(start, 'yyyy-MM-dd')} ～ ${format(end, 'yyyy-MM-dd')} / ${appId} / ${media} / ${requestedLevel}`,
    );
    setParams(
      {
        ...(appId === 'all' ? {} : { appId }),
        ...(media === 'all' ? {} : { media }),
      },
      { replace: true },
    );
    const next: BiDay[] = [];
    try {
      for (let i = 0; i < dayCount; i++) {
        const date = format(subDays(end, dayCount - i - 1), 'yyyy-MM-dd');
        setProgress(`读取 ${date} · ${i + 1}/${dayCount} 天`);
        try {
          next.push(
            await getBiDay(
              {
                date,
                level: requestedLevel,
                appId: appId === 'all' ? undefined : appId,
                media: media === 'all' ? undefined : media,
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
    for (const other of Object.keys(BI_LEVELS) as BiLevel[]) {
      if (other === requestedLevel || abort.signal.aborted) continue;
      for (let i = 0; i < dayCount; i++) {
        if (abort.signal.aborted) return;
        const date = format(subDays(end, dayCount - i - 1), 'yyyy-MM-dd');
        setWarming(`后台缓存：${BI_LEVELS[other]} · ${date}`);
        try {
          const warmed = await getBiDay(
            {
              date,
              level: other,
              appId: appId === 'all' ? undefined : appId,
              media: media === 'all' ? undefined : media,
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
      setWarming('全部维度预取已结束；切换自动读取，缺口可重新拉取。');
  };
  const rows = useMemo(() => biRows(days), [days]);
  const hasBad = (row: BiRow) =>
    columns.some((c) => biMetricSignal(row, c.key, standards).state === 'bad');
  const rowMeta = useMemo(() => {
    const result = new Map<string, MetaFilterItem>();
    for (const row of rows) {
      const entities = metaEntities.filter(
        (e) => e.campaignId === row.campaignId,
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
        metaConversionEvents: [
          ...new Set(
            unique.flatMap((e) =>
              e.conversionEvent ? [e.conversionEvent] : [],
            ),
          ),
        ],
      });
    }
    return result;
  }, [rows, metaEntities]);
  const filtered = useMemo(
    () =>
      rows
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
        <div className="flex flex-wrap gap-3">
          <div className="min-w-52">
            <Select value={appId} onValueChange={setAppId} disabled={busy}>
              <SelectTrigger aria-label="产品">
                <SelectValue />
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
          <div className="min-w-40">
            <Select value={media} onValueChange={setMedia} disabled={busy}>
              <SelectTrigger aria-label="渠道">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部渠道</SelectItem>
                {[...new Set(products.map((p) => p.channel))].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DateFilter label="从" value={start} change={setStart} />
          <DateFilter label="至" value={end} change={setEnd} />
          <Button disabled={busy} onClick={() => void load()}>
            {busy ? '读取中…' : '查询数据'}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void load(true)}
          >
            <RefreshCw className="mr-2 size-4" />
            重新拉取
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(BI_LEVELS).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              disabled={busy}
              variant={level === key ? 'default' : 'ghost'}
              onClick={() => {
                setLevel(key as BiLevel);
                void load(false, key as BiLevel);
              }}
            >
              {label}
            </Button>
          ))}
          <span className="ml-auto self-center text-xs text-slate-500">
            切换维度自动查询 · 后台预取全部维度 · 缓存 5 分钟 · 最多 31 天
          </span>
        </div>
      </section>
      {level === 'campaigns' && (
        <CampaignMetaFilters
          items={[...rowMeta.values()]}
          value={metaFilter}
          onChange={(value) => {
            setMetaFilter(value);
            setPage(0);
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
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ['消耗 ($)', total('spend')],
          ['Adjust 安装', total('installs')],
          ['当前 D0 收入 ($)', total('revenue')],
        ].map(([label, value]) => (
          <section
            key={String(label)}
            className="rounded-2xl border bg-white p-5"
          >
            <p className="text-sm text-slate-500">{label}</p>
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
                  <TableHead className="text-right">消耗 ($)</TableHead>
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
                  const spend = sum('spend'),
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
                setPage(0);
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
              setPage(0);
            }}
          >
            不达标优先
          </Button>
          <Button
            variant={badOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setBadOnly(!badOnly);
              setPage(0);
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
        <div className="max-h-[560px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-slate-50">
              <TableRow>
                <TableHead className="min-w-72">对象 / 产品 / 渠道</TableHead>
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
              {filtered.slice(page * 50, page * 50 + 50).map((row) => {
                const product = products.find(
                  (p) => p.appId === row.appId && p.channel === row.media,
                );
                return (
                  <TableRow
                    key={row.key}
                    className={hasBad(row) ? 'bg-red-50/40' : ''}
                  >
                    <TableCell>
                      <p className="max-w-96 break-words font-medium">
                        {row.label}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.appName} · {row.media}
                      </p>
                      {row.campaignName && row.campaignName !== row.label && (
                        <p className="max-w-96 break-words text-xs text-slate-400">
                          {row.campaignName}
                        </p>
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
                          查看决策
                          <ArrowRight className="size-3" />
                        </Link>
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
            第 {page + 1} / {Math.max(1, Math.ceil(filtered.length / 50))} 页 ·
            每页 50 条，非 Doris 截断
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * 50 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>
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
