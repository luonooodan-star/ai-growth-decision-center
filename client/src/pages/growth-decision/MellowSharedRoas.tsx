import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { MellowSharedRoas as Report } from '@shared/mellow-sharing.interface';

export function MellowSharedRoas({
  start,
  end,
}: {
  start: string;
  end: string;
}) {
  const [report, setReport] = useState<Report>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => active.current?.abort(), []);
  const sync = async () => {
    if (busy) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.post<Report>(
        '/api/growth-decision/analysis/mellow-roas',
        { start, end, platform: 'ios' },
        { signal: controller.signal, timeout: 150000 },
      );
      if (!controller.signal.aborted) setReport(data);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          axios.isAxiosError(e)
            ? e.response?.data?.message || '同步失败，已显示数据保留'
            : '同步失败',
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const value = (n: number | null | undefined, suffix = '') =>
    n == null ? '—' : `${n.toFixed(2)}${suffix}`;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Mellow iOS · 含自然量 D0 ROAS</h2>
        <button
          disabled={busy}
          onClick={() => void sync()}
          className="rounded-lg border px-4 py-2 text-sm text-blue-600 disabled:opacity-50"
        >
          {busy ? '同步中（保留当前数据）' : '读取 / 同步 iOS ROAS'}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        共享来源：growth · 仅 growth、fjx、jsa 可见。查询日期 {start} ～ {end}
        。全渠道 D0 收入（含自然量）÷ 全渠道消耗；使用 Doris 安装 cohort
        口径，不受下方漏斗标签、国家或平台筛选影响。
      </p>
      {report && (
        <>
          <p className="text-xs text-slate-500">
            已显示：{report.start} ～ {report.end} · 数据时间{' '}
            {report.updatedAt
              ? new Date(report.updatedAt).toLocaleString('zh-CN')
              : '未返回'}
          </p>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              ['全渠道消耗 ($)', value(report.spend)],
              ['D0 总收入 ($)', value(report.revenue)],
              ['其中自然量收入 ($)', value(report.organicRevenue)],
              ['含自然量 D0 ROAS', value(report.roas, '%')],
            ].map(([label, number]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-2 text-xl font-bold">{number}</p>
              </div>
            ))}
          </div>
          {report.issues.map((issue) => (
            <p key={issue} className="text-xs text-amber-700">
              {issue}
            </p>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
