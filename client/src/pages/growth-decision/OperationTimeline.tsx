import { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import type { OperationTimeline as Timeline } from '@shared/meta-operations';
import { getOperationTimeline } from '@/api/meta-operations';
import { Button } from '@/components/ui/button';

export function OperationTimeline({ id }: { id: string }) {
  const [data, setData] = useState<Timeline>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setData(await getOperationTimeline(id));
    } catch {
      setError('系列操作链加载失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  const time = (value: string) => new Date(value).toLocaleString('zh-CN');
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open && !data && !busy) void load();
      }}
      className="rounded-lg border p-4"
    >
      <summary className="cursor-pointer text-sm font-semibold text-blue-600">
        展开系列全部操作、趋势与追踪快照
      </summary>
      <p className="my-3 text-xs text-slate-500">
        同账户、同系列操作链。每次调整重新计时，每 3 小时记录一次（后台每 5
        分钟检查）；源端延迟和失败会留下缺口，不回填虚构时点。系列关停停止下级追踪，单广告关停不代表整个系列关停。仅记录本系统已确认的操作。
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void load()}
      >
        {busy ? '加载中…' : '刷新操作链'}
      </Button>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {data && (
        <>
          <ol className="my-4 max-h-72 space-y-2 overflow-auto text-sm">
            {data.operations.map((op) => (
              <li key={op.id} className="rounded-lg bg-slate-50 p-3">
                {time(op.occurredAt)} · {op.actorName} · {op.objectName}：
                {String(op.before ?? '—')} → {String(op.after ?? '—')}
                {op.changePct !== undefined &&
                  ` (${op.changePct >= 0 ? '+' : ''}${op.changePct.toFixed(1)}%)`}
              </li>
            ))}
          </ol>
          <p className="text-sm font-medium">
            D0 ROAS 快照趋势（最近 100 点，非三小时增量）
          </p>
          <div className="my-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.observations
                  .slice(0, 100)
                  .reverse()
                  .map((p) => ({
                    time: time(p.observedAt),
                    roas:
                      p.snapshot?.metrics.d0_roas === undefined
                        ? null
                        : p.snapshot.metrics.d0_roas * 100,
                  }))}
              >
                <XAxis dataKey="time" hide />
                <YAxis unit="%" />
                <Tooltip />
                <Line
                  dataKey="roas"
                  name="D0 ROAS (%)"
                  stroke="#2563eb"
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {data.truncated && (
            <p className="text-amber-700">
              仅显示最近 2000 条快照，更早记录仍留档。
            </p>
          )}
          <div className="mt-3 max-h-96 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white">
                <tr>
                  {[
                    '记录时间 / 类型',
                    '数据日 / 源端抓取时间',
                    '消耗',
                    'CPI',
                    'D0 ROAS',
                    '完整性',
                  ].map((h) => (
                    <th key={h} className="p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.observations.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2">
                      {time(p.observedAt)}
                      <br />
                      {p.kind === 'adjustment' ? '新调整锚点' : '3h 基础记录'}
                    </td>
                    <td className="p-2">
                      {p.snapshot?.dataDate || '未返回'}
                      <br />
                      {p.snapshot && time(p.snapshot.fetchedAt)}
                    </td>
                    <td>{p.snapshot?.metrics.spend ?? '—'}</td>
                    <td>{p.snapshot?.metrics.cpi ?? '—'}</td>
                    <td>
                      {p.snapshot?.metrics.d0_roas === undefined
                        ? '—'
                        : `${(p.snapshot.metrics.d0_roas * 100).toFixed(2)}%`}
                    </td>
                    <td className="max-w-64 p-2">
                      {!p.snapshot
                        ? p.note
                        : p.snapshot.qualityIssues.join('；') || '校验通过'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}
