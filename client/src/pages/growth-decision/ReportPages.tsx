import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { format, subDays } from 'date-fns';
import { shanghaiCalendarToday } from '@shared/paid-growth-dates';
import type { RoasReport } from '@shared/roas-report';
import type {
  CreativeAnalysisJob,
  CreativeAnalysisReport,
  FunnelCounts,
} from '@shared/creative-analysis.interface';
import { sumFunnel } from '@shared/creative-analysis';
import {
  startCreativeAnalysis,
  getCreativeAnalysis,
  cancelCreativeAnalysis,
} from '../../api/creative-analysis';
import { RangePicker } from './CreativeAnalysisPage';
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
  const yesterday = subDays(shanghaiCalendarToday(), 1);
  const [from, setFrom] = useState(subDays(yesterday, 6)),
    [to, setTo] = useState(yesterday);
  const [platform, setPlatform] = useState<'all' | 'android' | 'ios'>('all');
  const [buyer, setBuyer] = useState(''),
    [channel, setChannel] = useState('');
  const [roas, setRoas] = useState<RoasReport>(),
    [report, setReport] = useState<CreativeAnalysisReport>();
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
  const query = async (refresh = false) => {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError('');
    setProgress('正在查询');
    const q = {
      start: format(from, 'yyyy-MM-dd'),
      end: format(to, 'yyyy-MM-dd'),
      platform,
      refresh,
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
        if (job.report) setReport(job.report);
        else throw new Error(job.error || job.progress);
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
  const buyers = [...new Set(all.map((r) => r.buyer))].sort(),
    channels = [...new Set(all.map((r) => r.channel))].sort();
  const rows = (roas?.rows || []).filter(
    (r) => (!buyer || r.buyer === buyer) && (!channel || r.channel === channel),
  );
  const behaviorRows = (report?.rows || []).filter(
    (r) =>
      (!buyer || (r.buyer || '未确认归属') === buyer) &&
      (!channel || (r.channel || '未归因') === channel),
  );
  const groups = new Map<string, typeof behaviorRows>();
  for (const row of behaviorRows) {
    const key = JSON.stringify([
      row.platform,
      row.buyer || '未确认归属',
      row.channel || '未归因',
    ]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const metrics: [keyof Omit<FunnelCounts, 'users'>, string][] = [
    ['chat', '开聊'],
    ['chat5', '单角色 ≥5 条'],
    ['chat20', '单角色 ≥20 条'],
    ['payShow', '付费展示'],
    ['payClick', '展示后点击'],
    ['paySuccess', '展示点击后成功'],
    ['successAny', '任意付费成功事件'],
    ['orders', '购买成功订单用户'],
  ];
  const issues = behavior ? report?.issues : roas?.issues;
  const exportCsv = () => {
    const data = behavior
      ? [
          ['产品', '优化师', '渠道', 'D0首开用户', ...metrics.map((m) => m[1])],
          ...[...groups].map(([key, group]) => {
            const total = sumFunnel(group);
            return [
              ...JSON.parse(key),
              total.users,
              ...metrics.map(([m]) => total[m] ?? ''),
            ];
          }),
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
            r.channel,
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
            ? '按东八区 D0 首开去重用户关联当日行为，各阶段占比以首开用户为分母；未知归属单列。'
            : '安装同期群累计收入 ÷ 对应安装日全量媒体消耗。D0—D14，缺失值显示 —。渠道按 Doris 原始 media_source 分开显示。'}
        </p>
      </div>
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-5">
        <select
          aria-label="产品"
          className={input}
          value={platform}
          onChange={(e) => setPlatform(e.target.value as typeof platform)}
          disabled={busy}
        >
          <option value="all">全部 Mellow 产品</option>
          <option value="android">Mellow Android</option>
          <option value="ios">Mellow iOS</option>
        </select>
        <RangePicker
          from={from}
          to={to}
          disabled={busy}
          change={(a, b) => {
            setFrom(a);
            setTo(b);
          }}
        />
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
        <p className="w-full text-xs text-slate-500">
          确认产品和日期后点击查询；人员与渠道筛选使用已返回数据。
        </p>
      </section>
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
          <select
            aria-label="优化师"
            className={input}
            value={buyer}
            onChange={(e) => setBuyer(e.target.value)}
          >
            <option value="">全部优化师</option>
            {buyers.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <select
            aria-label="渠道"
            className={input}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="">全部渠道</option>
            {channels.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
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
          <div className="space-y-6">
            {[...groups].map(([key, group]) => {
              const [app, owner, media] = JSON.parse(key);
              const total = sumFunnel(group);
              return (
                <article key={key} className="rounded-xl border p-5">
                  <h2 className="font-semibold">
                    Mellow {app} · {owner} · {media}
                  </h2>
                  <p className="my-3 text-sm text-slate-500">
                    D0 首开用户 {total.users} 人
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {metrics.map(([metric, label]) => (
                      <div key={metric} className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">{label}</p>
                        <p className="my-1 font-semibold">
                          {total[metric] ?? '—'} 人 ·{' '}
                          {pct(total[metric], total.users)}
                        </p>
                        <div className="h-1.5 overflow-hidden rounded bg-slate-200">
                          <div
                            className="h-full bg-blue-500"
                            style={{
                              width: `${total[metric] === null || !total.users ? 0 : (100 * total[metric]!) / total.users}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
            {!groups.size && (
              <p className="py-12 text-center text-sm text-slate-500">
                {report ? '当前条件没有用户数据' : '选择日期后点击查询数据'}
              </p>
            )}
          </div>
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
                      {r.channel}
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
