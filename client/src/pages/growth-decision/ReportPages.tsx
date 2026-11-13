import BehaviorComparisonTable from './BehaviorComparisonTable';
import { BEHAVIOR_LABELS, mergeBehaviorCounts } from '@shared/behavior-table';
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { format, subDays } from 'date-fns';
import { shanghaiCalendarToday } from '@shared/paid-growth-dates';
import type { RoasReport } from '@shared/roas-report';
import type {
  CreativeAnalysisJob,
  CreativeAnalysisReport,
} from '@shared/creative-analysis.interface';
import {
  startCreativeAnalysis,
  getCreativeAnalysis,
  cancelCreativeAnalysis,
} from '../../api/creative-analysis';
import ReferenceReportFilters from './ReferenceReportFilters';
import {
  matchesReferenceReport,
  reportChannel,
  REPORT_CHANNEL_NAMES,
} from '@shared/reference-report-filters';
import AnalysisTabs from './AnalysisTabs';
const input = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
const button =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50';
const errorText = (e: unknown) =>
  axios.isAxiosError(e)
    ? String(e.response?.data?.message || e.message)
    : String(e);
const pct = (n: number | null, d: number) =>
  n === null || !d ? '—' : `${((100 * n) / d).toFixed(2)}%`;
export function RoasDataPage() {
  return <ReportPage behavior={false} />;
}
export function BehaviorDataPage() {
  return <ReportPage behavior />;
}
function ReportPage({ behavior }: { behavior: boolean }) {
  const [windowEnd] = useState(() =>
    behavior ? shanghaiCalendarToday() : subDays(shanghaiCalendarToday(), 1),
  );
  const [windowStart] = useState(
    () =>
      new Date(
        Math.max(
          new Date(2026, 10, 1).getTime(),
          subDays(windowEnd, 30).getTime(),
        ),
      ),
  );
  const [from, setFrom] = useState(windowStart),
    [to, setTo] = useState(windowEnd);
  const [platform, setPlatform] = useState<'all' | 'android' | 'ios'>('all');
  const [buyer, setBuyer] = useState(''),
    [channel, setChannel] = useState('');
  const [roas, setRoas] = useState<RoasReport>(),
    [report, setReport] = useState<CreativeAnalysisReport>();
  const [hourReport, setHourReport] = useState<CreativeAnalysisReport>();
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null),
    jobId = useRef('');
  useEffect(
    () => () => {
      abort.current?.abort();
      if (jobId.current)
        void cancelCreativeAnalysis(jobId.current).catch(() => {});
    },
    [],
  );
  const query = async (refresh = false, hourDate?: string) => {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError('');
    setProgress('正在查询');
    const q = {
      start: hourDate || format(windowStart, 'yyyy-MM-dd'),
      end: hourDate || format(windowEnd, 'yyyy-MM-dd'),
      platform: 'all' as const,
      refresh,
      behaviorDetail: behavior,
      hourly: !!hourDate,
    };
    try {
      if (!behavior)
        setRoas(
          (
            await axios.post<RoasReport>(
              '/api/growth-decision/roas-report',
              q,
              { signal: controller.signal, timeout: 180000 },
            )
          ).data,
        );
      else {
        let job: CreativeAnalysisJob = await startCreativeAnalysis(
          q,
          controller.signal,
        );
        jobId.current = job.id;
        while (job.state === 'running') {
          setProgress(job.progress);
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              clearTimeout(timer);
              reject(new Error('已停止等待'));
            };
            const timer = setTimeout(() => {
              controller.signal.removeEventListener('abort', onAbort);
              resolve();
            }, 1500);
            controller.signal.addEventListener('abort', onAbort, {
              once: true,
            });
          });
          job = await getCreativeAnalysis(job.id, controller.signal);
        }
        if (job.report) {
          if (hourDate) setHourReport(job.report);
          else {
            setReport(job.report);
            setHourReport(undefined);
          }
        } else throw new Error(job.error || job.progress);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorText(e));
    } finally {
      setBusy(false);
      jobId.current = '';
    }
  };
  const cancel = () => {
    abort.current?.abort();
    if (jobId.current)
      void cancelCreativeAnalysis(jobId.current).catch(() => {});
  };
  const all = behavior
    ? (report?.rows || []).map((r) => ({
        buyer: r.buyer || '未确认归属',
        channel: r.channel || '未归因',
      }))
    : roas?.rows || [];
  const scope = {
    buyer,
    channel,
    platform,
    start: format(from, 'yyyy-MM-dd'),
    end: format(to, 'yyyy-MM-dd'),
  };
  const rows = (roas?.rows || []).filter((r) =>
    matchesReferenceReport(
      { ...r, platform: r.appId === 3 ? 'ios' : 'android' },
      scope,
    ),
  );
  const behaviorRows = (report?.rows || []).filter((r) =>
    matchesReferenceReport({ ...r, buyer: r.buyer || '' }, scope),
  );
  const groups = new Map<string, typeof behaviorRows>();
  for (const row of behaviorRows) {
    const key = JSON.stringify([
      row.platform,
      row.buyer || '未确认归属',
      REPORT_CHANNEL_NAMES[reportChannel(row.channel)] || row.channel,
    ]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const issues = behavior
    ? [...(report?.issues || []), ...(hourReport?.issues || [])]
    : roas?.issues;
  const exportCsv = () => {
    const data = behavior
      ? [
          [
            '产品',
            '投放人员',
            '渠道',
            '日期',
            '应用内行为',
            '事件名',
            '去重用户数',
            '占样本比例',
            '事件次数',
          ],
          ...[...groups].flatMap(([key, group]) =>
            [...new Set(group.map((r) => r.date))]
              .sort()
              .reverse()
              .flatMap((date) => {
                const day = group.filter((r) => r.date === date),
                  base = day.reduce((n, r) => n + r.users, 0),
                  counts = mergeBehaviorCounts(day);
                return Object.entries(counts || {}).map(([event, c]) => [
                  ...JSON.parse(key),
                  date,
                  BEHAVIOR_LABELS[event] || event,
                  event,
                  c.users,
                  base ? (100 * c.users) / base : '',
                  c.events,
                ]);
              }),
          ),
        ]
      : [
          [
            '产品',
            '优化师',
            '渠道',
            '安装日期',
            '消耗',
            ...Array.from({ length: 15 }, (_, i) => `D${i} ROAS%`),
          ],
          ...rows.map((r) => [
            r.appId === 3 ? 'Mellow iOS' : 'Mellow Android',
            r.buyer,
            REPORT_CHANNEL_NAMES[reportChannel(r.channel)] || r.channel,
            r.date,
            r.spend,
            ...r.days.map((d) => (d ? (100 * d.revenue) / r.spend : '')),
          ]),
        ];
    const url = URL.createObjectURL(
      new Blob(
        [
          '\uFEFF' +
            data
              .map((row) =>
                row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','),
              )
              .join('\n'),
        ],
        { type: 'text/csv;charset=utf-8' },
      ),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = behavior ? 'behavior-funnel.csv' : 'roas.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="mx-auto max-w-[1540px] space-y-6 px-6 py-8">
      {behavior && <AnalysisTabs />}
      <div>
        <p className="text-xs tracking-widest text-blue-600">
          PERFORMANCE ANALYSIS
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          {behavior ? '优化师 / 渠道行为漏斗' : 'ROAS数据查看'}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {behavior
            ? '按日期对比应用内行为：去重用户数、占 D0 首开样本比例、事件次数。最新日期在左，点击日期可按东八区小时下探。'
            : '安装同期群累计收入 ÷ 对应安装日全量媒体消耗。D0—D14，缺失值显示 —。渠道按 Doris 原始 media_source 分开显示。'}
        </p>
      </div>
      <ReferenceReportFilters
        value={{ platform, buyer, channel, from, to }}
        min={windowStart}
        max={windowEnd}
        change={(v) => {
          setPlatform(v.platform);
          setBuyer(v.buyer);
          setChannel(v.channel);
          setFrom(v.from);
          setTo(v.to);
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button className={button} disabled={busy} onClick={() => void query()}>
          查询数据
        </button>
        <button
          className={input}
          disabled={busy}
          onClick={() => void query(true)}
        >
          重新抓取
        </button>
        {busy && (
          <button className={input} onClick={cancel}>
            停止等待
          </button>
        )}
        <span className="text-xs text-slate-500">
          每日东八区 10:00
          后台更新；查询与筛选读取持久缓存，缺失日期首次补齐。仅“重新抓取”主动刷新。
        </span>
      </div>
      {busy && (
        <p role="status" className="text-sm text-blue-600">
          {progress}，保留已有结果…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!!issues?.length && (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          {issues.map((issue, i) => (
            <p key={i}>{issue}</p>
          ))}
        </div>
      )}
      {!behavior && roas && (
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            [
              '当前筛选消耗',
              '$' + rows.reduce((n, r) => n + r.spend, 0).toFixed(2),
            ],
            ...[0, 7, 14].map((day) => [
              `D${day} 加权 ROAS`,
              rows.length && rows.every((r) => r.days[day] !== null)
                ? pct(
                    rows.reduce((n, r) => n + r.days[day]!.revenue, 0),
                    rows.reduce((n, r) => n + r.spend, 0),
                  ) + (rows.some((r) => !r.days[day]!.complete) ? '*' : '')
                : '—',
            ]),
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-white p-5">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
      <section className="rounded-2xl border bg-white p-5">
        <div className="mb-5 flex flex-wrap gap-3">
          <button className={input} onClick={exportCsv} disabled={!all.length}>
            导出 CSV
          </button>
          <span className="self-center text-xs text-slate-500">
            数据时间：
            {(behavior ? report?.generatedAt : roas?.generatedAt)
              ? new Date(
                  (behavior ? report?.generatedAt : roas?.generatedAt)!,
                ).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
              : '尚未查询'}
          </span>
        </div>
        {behavior ? (
          <BehaviorComparisonTable
            rows={behaviorRows}
            hourlyRows={hourReport?.rows || []}
            busy={busy}
            onDrill={(date) => void query(false, date)}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1800px] text-right text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {[
                    '产品 / 人员 / 渠道',
                    '安装日期',
                    '全量消耗',
                    ...Array.from({ length: 15 }, (_, i) => `D${i}`),
                  ].map((h) => (
                    <th className="min-w-24 px-3 py-3" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="whitespace-nowrap px-3 py-3 text-left">
                      Mellow {r.appId === 3 ? 'iOS' : 'Android'} / {r.buyer} /{' '}
                      {REPORT_CHANNEL_NAMES[reportChannel(r.channel)] ||
                        r.channel}
                    </td>
                    <td className="whitespace-nowrap px-3">{r.date}</td>
                    <td className="px-3">${r.spend.toFixed(2)}</td>
                    {r.days.map((d, j) => (
                      <td
                        key={j}
                        className={`px-3 py-3 ${d?.declining ? 'text-amber-700' : d && d.revenue / r.spend >= 1 ? 'bg-emerald-50 text-emerald-700' : ''}`}
                        title={
                          d
                            ? `累计收入 $${d.revenue.toFixed(4)}；${d.complete ? '观察完成' : '观察未完成'}`
                            : '暂无数据'
                        }
                      >
                        {d
                          ? `${((100 * d.revenue) / r.spend).toFixed(2)}%${d.complete ? '' : '*'}${d.declining ? ' ↓' : ''}`
                          : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="py-12 text-center text-sm text-slate-500">
                {roas ? '当前条件没有正消耗记录' : '选择日期后点击查询数据'}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
