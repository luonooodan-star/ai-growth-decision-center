import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  ArrowRight,
  CalendarDays,
  Copy,
  Filter,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { format, subDays, differenceInCalendarDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { shanghaiCalendarToday } from '@shared/paid-growth-dates';
import {
  cancelCreativeAnalysis,
  getCreativeAnalysis,
  startCreativeAnalysis,
} from '../../api/creative-analysis';
import type {
  CreativeAnalysisJob,
  CreativeAnalysisReport,
  FunnelCounts,
  FunnelMetric,
} from '@shared/creative-analysis.interface';
import {
  creativeCoverage,
  funnelRate,
  groupCreativeFunnel,
  matchFunnelRows,
  nextCreativeTags,
  sumFunnel,
} from '@shared/creative-analysis';
import {
  CREATIVE_TAG_GROUPS,
  CREATIVE_TAGS,
  isMetaAttribution,
  parseCreativeTags,
} from '@shared/creative-tags';
import { CREATIVE_TAG_V2_PROMPT } from '@shared/creative-tag-v2-prompt';

const box = 'rounded-2xl border border-slate-200 bg-white';
const button =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const input =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const count = (value: number | null) =>
  value === null ? '—' : value.toLocaleString('zh-CN');
const percent = (value: number | null) =>
  value === null ? '—' : `${value.toFixed(2)}%`;
const rate = (n: number | null, d: number | null) => percent(funnelRate(n, d));
const errorText = (error: unknown) =>
  axios.isAxiosError(error)
    ? String(error.response?.data?.message || error.message)
    : error instanceof Error
      ? error.message
      : '查询失败';
const groupLabel = (code: string) =>
  CREATIVE_TAGS[code]?.groups
    .map((group) => CREATIVE_TAG_GROUPS.find(([id]) => id === group)?.[1])
    .join(' / ') || '';

function RangePicker({
  from,
  to,
  disabled,
  change,
}: {
  from: Date;
  to: Date;
  disabled: boolean;
  change: (from: Date, to: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>();
  const [error, setError] = useState('');
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setDraft(undefined);
        setError('');
      }}
    >
      <PopoverTrigger asChild>
        <button className={button} disabled={disabled}>
          <CalendarDays className="size-4" />
          {format(from, 'yyyy-MM-dd')} ～ {format(to, 'yyyy-MM-dd')}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] overflow-auto p-2">
        <p className="px-3 py-1 text-xs text-slate-500">
          依次选择开始、结束日期；最多 31 天
        </p>
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={draft}
          disabled={{ after: shanghaiCalendarToday() }}
          onSelect={(_range, day) => {
            if (!draft?.from || draft.to) {
              setDraft({ from: day });
              return;
            }
            const start = day < draft.from ? day : draft.from;
            const end = day < draft.from ? draft.from : day;
            if (differenceInCalendarDays(end, start) > 30) {
              setError('最多选择 31 天');
              setDraft({ from: day });
              return;
            }
            change(start, end);
            setOpen(false);
          }}
        />
        {error && <p className="px-3 text-sm text-red-600">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

function Funnel({
  title,
  description,
  counts,
  baseline,
  stages,
}: {
  title: string;
  description: string;
  counts: FunnelCounts;
  baseline: FunnelCounts;
  stages: [string, 'users' | FunnelMetric][];
}) {
  return (
    <section className={`${box} p-5`}>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      <div className="mt-5 space-y-4">
        {stages.map(([label, field], index) => {
          const current = counts[field];
          const previous = index ? counts[stages[index - 1][1]] : counts.users;
          const currentRate = funnelRate(current, counts.users);
          const baseRate = funnelRate(baseline[field], baseline.users);
          const delta =
            currentRate === null || baseRate === null
              ? null
              : currentRate - baseRate;
          return (
            <div key={field}>
              <div className="mb-1 flex justify-between gap-3 text-sm">
                <span>{label}</span>
                <span className="font-semibold tabular-nums">
                  {count(current)}{' '}
                  <span className="font-normal text-slate-500">
                    · {percent(currentRate)}
                  </span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width]"
                  style={{ width: `${Math.min(100, currentRate || 0)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate-500">
                <span>
                  {index
                    ? `上一步转化 ${rate(current, previous)}`
                    : '当前选择的首开用户'}
                </span>
                {index > 0 && (
                  <span>
                    较上层{' '}
                    {delta === null
                      ? '—'
                      : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pp`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PromptPanel() {
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState('');
  const parsed = useMemo(() => parseCreativeTags(name), [name]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CREATIVE_TAG_V2_PROMPT);
      setCopied('已复制');
    } catch {
      setCopied('浏览器未允许复制，可选中下方原文手动复制');
    }
  };
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className={`${box} p-5`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">原版 V2 提示词</h2>
          <button className={button} onClick={() => void copy()}>
            <Copy className="size-4" />
            复制全文
          </button>
        </div>
        <p className="mt-2 text-xs leading-6 text-slate-500">
          来自「广告标签提示词完善」。保留原始 V2 词表和 8–10
          标签规则，不自动替换为后续讨论建议。本页用于查看、命名校验和分析，不自动调用模型为素材打标。
        </p>
        {copied && (
          <p role="status" className="mt-2 text-sm text-blue-600">
            {copied}
          </p>
        )}
        <pre className="mt-4 max-h-[680px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">
          {CREATIVE_TAG_V2_PROMPT}
        </pre>
      </section>
      <div className="space-y-5">
        <section className={`${box} p-5`}>
          <h2 className="font-semibold">素材命名检查</h2>
          <p className="mt-2 text-xs text-slate-500">
            粘贴素材文件名，检查可识别标签与词表外代码；不改动原文件。
          </p>
          <textarea
            className={`${input} mt-4 min-h-24 w-full`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mellow_img_solomale_…_01_v2.png"
            aria-label="待检查素材名称"
          />
          {name && (
            <div className="mt-3 space-y-3">
              <p className="text-sm">
                版本：{parsed.version === 'v2' ? 'V2' : '未识别'} · 标准标签{' '}
                {parsed.codes.length} 个
              </p>
              <div className="flex flex-wrap gap-2">
                {parsed.codes.map((code) => (
                  <span
                    key={code}
                    className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
                  >
                    {code} · {CREATIVE_TAGS[code].labels.join(' / ')}
                  </span>
                ))}
              </div>
              {parsed.warnings.map((warning) => (
                <p key={warning} className="text-xs text-amber-700">
                  {warning}
                </p>
              ))}
              <p className="text-xs text-slate-500">
                这里检查可解析性、数量和词表，不判断图片是否真正符合这些标签。
              </p>
            </div>
          )}
        </section>
        <section className={`${box} p-5`}>
          <h2 className="font-semibold">V2 标签词典</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            dark、mys
            等代码在多个维度复用。分析按原始代码筛选，不强行推断其含义。
          </p>
          <input
            className={`${input} mt-3 w-full`}
            placeholder="搜索代码 / 中文含义"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="搜索标签词典"
          />
          <div className="mt-3 max-h-96 overflow-auto divide-y divide-slate-100">
            {Object.values(CREATIVE_TAGS)
              .filter((tag) =>
                `${tag.code} ${tag.labels.join(' ')}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((tag) => (
                <div key={tag.code} className="py-2 text-sm">
                  <span className="font-mono text-blue-700">{tag.code}</span> ·{' '}
                  {tag.labels.join(' / ')}
                  <p className="mt-1 text-xs text-slate-500">
                    {groupLabel(tag.code)}
                  </p>
                </div>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function CreativeAnalysisPage() {
  const [sharing, setSharing] = useState<{
    enabled: boolean;
    recipient: boolean;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    void axios
      .get('/api/growth-decision/analysis/sharing', {
        signal: controller.signal,
        timeout: 15000,
      })
      .then((r) => {
        setSharing(r.data);
        if (r.data.recipient) setSource('all');
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const [tab, setTab] = useState<'analysis' | 'prompt'>('analysis');
  const [from, setFrom] = useState(() => subDays(shanghaiCalendarToday(), 3));
  const [to, setTo] = useState(() => subDays(shanghaiCalendarToday(), 1));
  const [queryPlatform, setQueryPlatform] = useState<'android' | 'ios' | 'all'>(
    'android',
  );
  const [job, setJob] = useState<CreativeAnalysisJob>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<CreativeAnalysisReport>();
  const [country, setCountry] = useState('');
  const [platform, setPlatform] = useState('all');
  const [source, setSource] = useState<'all' | 'meta'>('meta');
  const [tags, setTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [tagGroup, setTagGroup] = useState('');
  const [minimum, setMinimum] = useState(1);
  const [dimension, setDimension] = useState<
    'country' | 'date' | 'creativeName'
  >('country');
  const [copyState, setCopyState] = useState('');
  const [detailLimit, setDetailLimit] = useState(200);
  const mounted = useRef(true);
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const busy = starting || job?.state === 'running';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
    };
  }, []);
  const receive = (next: CreativeAnalysisJob) => {
    setJob(next);
    if (next.report) {
      setReport(next.report);
      setCountry('');
      setPlatform('all');
      setTags([]);
    }
    if (next.error) setError(next.error);
  };
  const query = async (refresh = false) => {
    if (busy) return;
    setStarting(true);
    setError('');
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const next = await startCreativeAnalysis(
        {
          start: format(from, 'yyyy-MM-dd'),
          end: format(to, 'yyyy-MM-dd'),
          platform: queryPlatform,
          refresh,
        },
        controller.signal,
      );
      if (mounted.current) receive(next);
    } catch (e) {
      if (mounted.current && !controller.signal.aborted) setError(errorText(e));
    } finally {
      if (mounted.current) setStarting(false);
    }
  };
  useEffect(() => {
    if (!job || job.state !== 'running') return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let failures = 0;
    const poll = async () => {
      try {
        const next = await getCreativeAnalysis(job.id, controller.signal);
        if (disposed) return;
        failures = 0;
        setError('');
        receive(next);
        if (next.state === 'running')
          timer = setTimeout(() => void poll(), 2000);
      } catch (e) {
        if (disposed) return;
        failures++;
        setError(`读取任务进度失败：${errorText(e)}。已显示数据保留。`);
        if (failures < 3) timer = setTimeout(() => void poll(), 5000);
        else
          setJob((old) =>
            old
              ? {
                  ...old,
                  state: 'failed',
                  progress: '进度连接中断；再次查询可恢复仍在运行的任务',
                }
              : old,
          );
      }
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [job?.id, job?.state]);
  const stop = async () => {
    if (!job) return;
    try {
      receive(await cancelCreativeAnalysis(job.id));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const rows = report?.rows || [];
  const scoped = useMemo(
    () => matchFunnelRows(report?.rows || [], { country, platform, source }),
    [report, country, platform, source],
  );
  const selected = useMemo(
    () => matchFunnelRows(scoped, { tags }),
    [scoped, tags],
  );
  useEffect(() => setDetailLimit(200), [selected, dimension]);
  const totals = useMemo(() => sumFunnel(selected), [selected]);
  const baseline = useMemo(
    () => sumFunnel(matchFunnelRows(scoped, { tags: tags.slice(0, -1) })),
    [scoped, tags],
  );
  const candidates = useMemo(
    () => nextCreativeTags(scoped, tags),
    [scoped, tags],
  );
  const visibleCandidates = candidates.filter(
    (item) =>
      item.users >= minimum &&
      (!tagGroup || CREATIVE_TAGS[item.tag].groups.includes(tagGroup)) &&
      `${item.tag} ${CREATIVE_TAGS[item.tag].labels.join(' ')}`
        .toLowerCase()
        .includes(tagSearch.toLowerCase()),
  );
  const countries = [...new Set(rows.map((row) => row.country))].sort();
  const detail = useMemo(
    () =>
      groupCreativeFunnel(selected, dimension).sort((a, b) =>
        dimension === 'date'
          ? a.label.localeCompare(b.label) ||
            a.platform.localeCompare(b.platform)
          : b.users - a.users,
      ),
    [selected, dimension],
  );
  const v2 = scoped.filter(
    (row) => row.tags.version === 'v2' && row.tags.codes.length > 0,
  );
  const rootUsers = sumFunnel(scoped).users;
  const unknown = rows.filter((row) => row.attribution !== 'matched');
  const copyEvidence = async () => {
    if (!report) return;
    const evidence = {
      scope: report.scope,
      generatedAt: report.generatedAt,
      filters: { country, platform, source, tags, relation: 'AND' },
      counts: totals,
      parentCounts: baseline,
      coverage: { rootUsers, parsedV2Users: sumFunnel(v2).users },
      candidates,
      details: detail,
      issues: report.issues,
    };
    const text = `请依据以下 V2 命名规范和聚合证据，分析素材标签与 D0 行为的关联，并提出下一轮可验证的素材假设。\n不要把相关性当成因果，不要将共现标签相加当成独立样本。对低样本、未归因和订单缺失单列说明。聊天深度按同一角色计算，付费漏斗为当日事件交集而非时间顺序，订单与成功埋点独立。\n\n${CREATIVE_TAG_V2_PROMPT}\n\n聚合证据（无用户明细）：\n${JSON.stringify(evidence, null, 2)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('已复制 V2 提示词与当前聚合证据');
    } catch {
      setCopyState('浏览器未允许复制，请在安全连接中使用复制功能');
    }
  };
  return (
    <main className="mx-auto max-w-[1540px] space-y-6 px-5 py-8 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-blue-600">
            CREATIVE INTELLIGENCE
          </p>
          <h1 className="mt-2 text-2xl font-bold">素材标签 × 用户漏斗</h1>
          <p className="mt-2 text-sm text-slate-500">
            从一个标签开始，逐层交叉，看到素材吸引的用户如何聊天、如何付费。
          </p>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1">
          {(
            [
              ['analysis', '标签与漏斗'],
              ['prompt', 'V2 提示词与命名检查'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-lg px-4 py-2 text-sm ${tab === id ? 'bg-white font-semibold text-blue-600 shadow-sm' : 'text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div hidden={tab !== 'analysis'} className="space-y-6">
        <section className={`${box} p-5`}>
          <div className="flex flex-wrap items-end gap-4">
            <label className="space-y-2 text-xs text-slate-500">
              <span className="block">产品 / 已核实的数据口径</span>
              <select
                className={input}
                value={queryPlatform}
                disabled={busy}
                onChange={(e) =>
                  setQueryPlatform(e.target.value as typeof queryPlatform)
                }
              >
                <option value="android">Mellow · Android</option>
                <option value="ios">Mellow · iOS</option>
                <option value="all">Mellow · 双平台（分别统计）</option>
              </select>
            </label>
            <div className="space-y-2">
              <p className="text-xs text-slate-500">首开日期 · D0 当天行为</p>
              <RangePicker
                from={from}
                to={to}
                disabled={busy}
                change={(start, end) => {
                  setFrom(start);
                  setTo(end);
                }}
              />
            </div>
            <button
              className={`${button} !border-blue-600 !bg-blue-600 !text-white`}
              disabled={busy}
              onClick={() => void query()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              查询数据
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => void query(true)}
            >
              {sharing?.recipient ? '同步共享数据（缓存优先）' : '重新抓取'}
            </button>
            {busy && job && (
              <button className={button} onClick={() => void stop()}>
                停止任务
              </button>
            )}
          </div>
          <p className="mt-3 text-xs leading-6 text-slate-500">
            {sharing?.recipient
              ? '定向共享：growth 的 Mellow iOS / Android 全量分析数据（含自然量），不共享 Key，不改变个人广告权限。仅查询时按需同步，缓存优先。'
              : '仅点击查询后读取 Doris，按个人 Key 权限取数；历史有效缓存优先。'}
            下方标签、国家和平台交叉筛选不发起新查询。不会执行广告调整。
          </p>
          {job && (
            <p role="status" className="mt-2 text-sm text-blue-700">
              {job.progress}
              {busy && report ? ' · 原结果保留，完成后替换' : ''}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
        </section>
        {!report ? (
          <section className={`${box} px-6 py-16 text-center`}>
            <Filter className="mx-auto size-8 text-blue-500" />
            <h2 className="mt-4 text-lg font-semibold">
              先确定人群，再逐层看标签
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-500">
              选择首开日期和平台，点击查询数据。加载后从所有标签中选择 tag
              1，下一层仅展示与它共同出现的标签；继续叠加 tag 2、tag
              3，观察用户漏斗差异。
            </p>
            <p className="mt-4 text-xs text-slate-400">
              本页未查询时不展示示例数字，也不会自动抓取。
            </p>
          </section>
        ) : (
          <>
            <div className="flex flex-wrap justify-between gap-3 text-xs text-slate-500">
              <p>
                当前结果：{report.scope.start} ～ {report.scope.end} ·{' '}
                {report.sharedOwner ? 'growth 定向共享 · ' : ''}
                {report.scope.platform} ·{' '}
                {report.cache ? '有效缓存' : '本次读取'} ·{' '}
                {new Date(report.generatedAt).toLocaleString('zh-CN')}
              </p>
              <button
                className="text-blue-600"
                onClick={() => void copyEvidence()}
              >
                复制 Codex 复盘材料 ↗
              </button>
            </div>
            {copyState && (
              <p role="status" className="text-sm text-blue-600">
                {copyState}
              </p>
            )}
            {report.issues.length > 0 && (
              <details
                open
                className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
              >
                <summary className="cursor-pointer font-medium">
                  数据完整性提示（{report.issues.length}）
                </summary>
                {report.issues.map((issue) => (
                  <p key={issue} className="mt-2 break-words">
                    {issue}
                  </p>
                ))}
              </details>
            )}
            <section className={`${box} p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold">01 · 确定比较人群</h2>
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="归因范围"
                    className={input}
                    value={source}
                    onChange={(e) => {
                      setSource(e.target.value as typeof source);
                      setTags([]);
                    }}
                  >
                    <option value="meta">Meta 已归因用户</option>
                    <option value="all">全部首开用户（含未归因）</option>
                  </select>
                  <select
                    aria-label="本地平台筛选"
                    className={input}
                    value={platform}
                    onChange={(e) => {
                      setPlatform(e.target.value);
                      setTags([]);
                    }}
                  >
                    <option value="all">全部已加载平台</option>
                    {[...new Set(rows.map((row) => row.platform))].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="国家筛选"
                    className={input}
                    value={country}
                    onChange={(e) => {
                      setCountry(e.target.value);
                      setTags([]);
                    }}
                  >
                    <option value="">全部国家</option>
                    {countries.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  [
                    '当前范围首开用户',
                    count(rootUsers),
                    '国家、平台与来源条件同时满足',
                  ],
                  [
                    '可解析 V2 用户',
                    count(sumFunnel(v2).users),
                    `覆盖当前范围 ${rate(sumFunnel(v2).users, rootUsers)}`,
                  ],
                  [
                    '有素材，无 V2 标签',
                    count(
                      sumFunnel(
                        scoped.filter(
                          (row) =>
                            creativeCoverage(row) === '有素材，无 V2 标签',
                        ),
                      ).users,
                    ),
                    '素材已归因，可看漏斗；不能参与 V2 标签交叉',
                  ],
                  ...[
                    '无素材归因',
                    '有素材 ID，名称缺失',
                    '有 V2 标记，标签未解析',
                    '归因冲突',
                    '归因读取失败',
                  ].map((status) => [
                    status,
                    count(
                      sumFunnel(
                        scoped.filter(
                          (row) => creativeCoverage(row) === status,
                        ),
                      ).users,
                    ),
                    '缺失与命名问题分开统计，不强行分配素材',
                  ]),
                  [
                    '包含词表外代码',
                    count(
                      sumFunnel(
                        scoped.filter((row) => row.tags.unknown.length > 0),
                      ).users,
                    ),
                    '标准标签仍可分析，未知代码不自动归类',
                  ],
                ].map(([label, value, note]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-bold tabular-nums">
                      {value}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">{note}</p>
                  </div>
                ))}
              </div>
              <details className="mt-4 text-xs leading-6 text-slate-500">
                <summary className="cursor-pointer">
                  全查询范围的归因覆盖与排除项
                </summary>
                <p>
                  全部首开 {count(sumFunnel(rows).users)} 人；Meta 明确归因{' '}
                  {count(
                    sumFunnel(
                      rows.filter(
                        (row) =>
                          row.attribution === 'matched' &&
                          isMetaAttribution(row.channel),
                      ),
                    ).users,
                  )}{' '}
                  人；未归因 / 归因冲突 / 归因读取缺失合计{' '}
                  {count(sumFunnel(unknown).users)} 人。
                </p>
                <p>
                  排除无有效用户 ID 的首开事件 {report.excludedFirstOpenEvents}{' '}
                  次；{report.duplicateFirstOpenUsers}{' '}
                  人出现重复首开记录，取查询范围内最早首开日。不是跨全历史去重的新注册口径。
                </p>
              </details>
            </section>
            <section className={`${box} p-5`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">02 · 标签逐层交叉</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    AND 交集 · 每一层只留下同时包含全部已选标签的人群
                  </p>
                </div>
                {tags.length > 0 && (
                  <button className={button} onClick={() => setTags([])}>
                    清空标签
                  </button>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  className="rounded-lg bg-slate-100 px-3 py-2 text-sm"
                  onClick={() => setTags([])}
                >
                  当前人群 · {count(rootUsers)}
                </button>
                {tags.map((tag, i) => (
                  <div key={tag} className="flex items-center gap-2">
                    <ArrowRight className="size-4 text-slate-400" />
                    <span className="inline-flex items-center rounded-lg bg-blue-50 text-sm text-blue-700">
                      <button
                        className="px-3 py-2"
                        onClick={() => setTags(tags.slice(0, i + 1))}
                      >
                        {tag} ·{' '}
                        {count(
                          sumFunnel(
                            matchFunnelRows(scoped, {
                              tags: tags.slice(0, i + 1),
                            }),
                          ).users,
                        )}
                      </button>
                      <button
                        className="p-2"
                        aria-label={`移除 ${tag}`}
                        onClick={() => setTags(tags.filter((t) => t !== tag))}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <input
                  className={`${input} min-w-56 flex-1`}
                  placeholder="搜索下一级标签 / 中文含义"
                  aria-label="搜索可交叉标签"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                />
                <select
                  aria-label="标签维度"
                  className={input}
                  value={tagGroup}
                  onChange={(e) => setTagGroup(e.target.value)}
                >
                  <option value="">全部标签维度</option>
                  {CREATIVE_TAG_GROUPS.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  最少样本
                  <input
                    className={`${input} w-20`}
                    type="number"
                    min="1"
                    value={minimum}
                    onChange={(e) =>
                      setMinimum(Math.max(1, Number(e.target.value) || 1))
                    }
                  />
                </label>
              </div>
              <div className="mt-4 max-h-96 overflow-auto rounded-lg border border-slate-100">
                <table className="w-full whitespace-nowrap text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      {[
                        '可继续交叉的标签',
                        '用户数',
                        '聊天率',
                        '同角色 20 次率',
                        '订单用户 / 率',
                        '',
                      ].map((label, i) => (
                        <th key={i} className="px-3 py-3">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleCandidates.map((item) => (
                      <tr key={item.tag} className="hover:bg-blue-50/50">
                        <td className="px-3 py-3">
                          <p className="font-medium text-blue-700">
                            {item.tag}{' '}
                            <span className="font-normal text-slate-600">
                              · {CREATIVE_TAGS[item.tag].labels.join(' / ')}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {groupLabel(item.tag)}
                          </p>
                        </td>
                        <td className="px-3 tabular-nums">
                          {count(item.users)}
                          {item.users < 30 && (
                            <span className="ml-2 text-xs text-amber-600">
                              小样本
                            </span>
                          )}
                        </td>
                        <td className="px-3">{rate(item.chat, item.users)}</td>
                        <td className="px-3">
                          {rate(item.chat20, item.users)}
                        </td>
                        <td className="px-3">
                          {count(item.orders)} / {rate(item.orders, item.users)}
                        </td>
                        <td className="px-3">
                          <button
                            className="rounded border border-blue-200 px-3 py-1 text-blue-600 hover:bg-blue-50"
                            onClick={() => setTags([...tags, item.tag])}
                          >
                            ＋ 交叉
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visibleCandidates.length && (
                  <p className="p-8 text-center text-sm text-slate-500">
                    当前条件下没有可继续叠加的标签。可退回上层，或放宽标签搜索 /
                    最少样本条件。
                  </p>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                标签存在共现，同一用户可能出现在多个候选标签中，不能将各行人数相加。选择标签后按用户交集计算，不从单标签汇总反推。
              </p>
            </section>
            <section>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-semibold">03 · 当前人群的 D0 行为</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {tags.length ? tags.join(' ∩ ') : '未限定标签'} ·{' '}
                    {count(totals.users)} 人 · 对比
                    {tags.length ? '上一级标签人群' : '当前基础人群'}
                  </p>
                </div>
                {totals.users < 30 && (
                  <p className="text-xs text-amber-700">
                    当前样本较少，请勿直接作为投放结论
                  </p>
                )}
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <Funnel
                  title="聊天深度"
                  description="首开当天；5 次与 20 次按同一角色的成功发送次数计算，不跨角色累加。"
                  counts={totals}
                  baseline={baseline}
                  stages={[
                    ['首开用户', 'users'],
                    ['至少一次成功聊天', 'chat'],
                    ['同一角色 ≥5 次', 'chat5'],
                    ['同一角色 ≥20 次', 'chat20'],
                  ]}
                />
                <Funnel
                  title="付费事件漏斗"
                  description="首开当天的用户事件交集，不代表事件发生顺序。成功埋点不等于已核实订单。"
                  counts={totals}
                  baseline={baseline}
                  stages={[
                    ['首开用户', 'users'],
                    ['看到付费页', 'payShow'],
                    ['展示 ∩ 点击', 'payClick'],
                    ['展示 ∩ 点击 ∩ 成功', 'paySuccess'],
                  ]}
                />
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className={`${box} p-4`}>
                  <p className="text-xs text-slate-500">
                    任意付费成功埋点（不要求展示/点击）
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {count(totals.successAny)} 人{' '}
                    <span className="text-sm font-normal text-slate-500">
                      · {rate(totals.successAny, totals.users)}
                    </span>
                  </p>
                </div>
                <div className={`${box} p-4`}>
                  <p className="text-xs text-slate-500">
                    当前人群 · D0 订单确认用户（iOS / Android）
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {totals.users ? count(totals.orders) : '—'}{' '}
                    <span className="text-sm font-normal text-slate-500">
                      / {count(totals.users)} 人 ·{' '}
                      {rate(totals.orders, totals.users)}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Production / PURCHASED；仅计首开同日订单，按用户去重
                  </p>
                </div>
                <div className={`${box} p-4`}>
                  <p className="text-xs text-slate-500">所选人群占基础范围</p>
                  <p className="mt-2 text-xl font-semibold">
                    {rate(totals.users, rootUsers)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    缺失值为 —，不补零，不据此判断无转化
                  </p>
                </div>
              </div>
            </section>
            <section className={`${box} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
                <div>
                  <h2 className="font-semibold">04 · 交叉人群明细</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    随标签路径同步变化，平台分别统计
                  </p>
                </div>
                <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
                  {(
                    [
                      ['country', '国家'],
                      ['date', '日期趋势'],
                      ['creativeName', '素材'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      className={`rounded px-3 py-1.5 text-sm ${dimension === id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                      onClick={() => setDimension(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      {[
                        '对象 / 平台',
                        '首开用户',
                        '聊天用户 / 率',
                        '5 次用户 / 率',
                        '20 次用户 / 率',
                        '付费漏斗成功 / 率',
                        '订单用户 / 率',
                      ].map((label) => (
                        <th key={label} className="whitespace-nowrap px-4 py-3">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.slice(0, detailLimit).map((item) => (
                      <tr key={item.key}>
                        <td className="min-w-48 max-w-md break-words px-4 py-3">
                          <p>{item.label}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {item.platform}
                          </p>
                        </td>
                        <td className="px-4">{count(item.users)}</td>
                        {(
                          [
                            'chat',
                            'chat5',
                            'chat20',
                            'paySuccess',
                            'orders',
                          ] as const
                        ).map((metric) => (
                          <td
                            key={metric}
                            className="whitespace-nowrap px-4 tabular-nums"
                          >
                            {count(item[metric])}{' '}
                            <span className="text-slate-400">
                              / {rate(item[metric], item.users)}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!detail.length && (
                  <p className="p-8 text-center text-sm text-slate-500">
                    当前交叉条件下无用户数据
                  </p>
                )}
              </div>
              {detail.length > detailLimit && (
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-4 text-xs text-slate-500">
                  <p>
                    共 {detail.length} 组，已展示 {detailLimit}{' '}
                    组；上方统计和复制材料均包含完整结果。
                  </p>
                  <button
                    className={button}
                    onClick={() => setDetailLimit((old) => old + 200)}
                  >
                    继续显示 200 组
                  </button>
                </div>
              )}
            </section>
            <p className="text-xs leading-6 text-slate-500">
              分析用于发现关联与下一轮实验假设。国家、素材、日期和投放人群可能共同影响表现；未控制这些变量时，不将某个标签判定为转化原因。D0
              按 Doris 的 event_date 对齐，日期选择以当前上海日期为上限。
            </p>
          </>
        )}
      </div>
      {tab === 'prompt' && <PromptPanel />}
    </main>
  );
}
