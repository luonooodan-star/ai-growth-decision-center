import { Fragment, useState } from 'react';
import type { CreativeFunnelRow } from '@shared/creative-analysis.interface';
import {
  BEHAVIOR_LABELS,
  BEHAVIOR_ORDER,
  mergeBehaviorCounts,
} from '@shared/behavior-table';
import {
  reportChannel,
  REPORT_CHANNEL_NAMES,
} from '@shared/reference-report-filters';
export default function BehaviorComparisonTable({
  rows,
  hourlyRows,
  busy,
  onDrill,
}: {
  rows: CreativeFunnelRow[];
  hourlyRows: CreativeFunnelRow[];
  busy: boolean;
  onDrill: (date: string) => void;
}) {
  const [expanded, setExpanded] = useState<{ group: string; date: string }>();
  const groups = new Map<string, CreativeFunnelRow[]>();
  const keyOf = (r: CreativeFunnelRow) =>
    JSON.stringify([r.platform, r.buyer, reportChannel(r.channel)]);
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const table = (
    source: CreativeFunnelRow[],
    columns: string[],
    hourly: boolean,
  ) => {
    const cells = columns.map((column) => {
      const parts = source.filter((r) =>
        hourly ? String(r.hour) === column : r.date === column,
      );
      return {
        column,
        base: parts.reduce((n, r) => n + r.users, 0),
        counts: parts.length ? mergeBehaviorCounts(parts) : null,
      };
    });
    const eventNames = [
      ...new Set(source.flatMap((r) => Object.keys(r.behaviors || {}))),
    ];
    const events = [
      ...BEHAVIOR_ORDER,
      ...eventNames.filter((e) => !BEHAVIOR_ORDER.includes(e)).sort(),
    ];
    return (
      <div className="max-h-[680px] overflow-auto rounded-xl border">
        <table className="w-full border-collapse whitespace-nowrap text-right text-sm">
          <thead className="sticky top-0 z-20 bg-slate-50">
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-30 min-w-56 border-b bg-slate-50 px-4 py-3 text-left"
              >
                应用内行为
              </th>
              {cells.map((c) => (
                <th
                  key={c.column}
                  colSpan={3}
                  className="border-b border-l px-4 py-3 text-center"
                >
                  {hourly ? (
                    `${c.column.padStart(2, '0')}:00—${c.column.padStart(2, '0')}:59`
                  ) : (
                    <button
                      disabled={busy}
                      className="text-blue-600 underline underline-offset-4 disabled:opacity-50"
                      onClick={() => {
                        const group = source[0] ? keyOf(source[0]) : '';
                        setExpanded({ group, date: c.column });
                        onDrill(c.column);
                      }}
                    >
                      {c.column} · 按小时下探
                    </button>
                  )}
                  <p className="mt-1 text-xs font-normal text-slate-500">
                    {hourly ? '当日 D0 样本' : 'D0 样本'} {c.base} 人
                  </p>
                </th>
              ))}
            </tr>
            <tr>
              {cells.map((c) =>
                ['去重用户数', '占样本比例', '事件次数'].map((label) => (
                  <th
                    key={c.column + label}
                    className="min-w-28 border-b px-3 py-2 text-xs font-medium text-slate-500"
                  >
                    {label}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr
                key={event}
                className="border-b last:border-0 hover:bg-slate-50"
              >
                <th
                  title={event}
                  className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-medium"
                >
                  {BEHAVIOR_LABELS[event] || event}
                  <p className="max-w-64 truncate text-[10px] font-normal text-slate-400">
                    {event}
                  </p>
                </th>
                {cells.map((c) => {
                  const n = c.counts?.[event] || { users: 0, events: 0 };
                  return (
                    <Fragment key={c.column}>
                      <td key={c.column + 'u'} className="border-l px-3 py-3">
                        {c.counts ? n.users : '—'}
                      </td>
                      <td key={c.column + 'p'} className="px-3 py-3">
                        {c.counts && c.base
                          ? `${((100 * n.users) / c.base).toFixed(1)}%`
                          : '—'}
                      </td>
                      <td key={c.column + 'e'} className="px-3 py-3">
                        {c.counts ? n.events : '—'}
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };
  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500">
        各行为独立去重；消息里程碑按实际埋点计数，不用消息条数推算。未识别的事件显示原埋点名，缺失数据展示
        —。
      </p>
      {[...groups].map(([key, group]) => {
        const [platform, buyer, channel] = JSON.parse(key);
        const dates = [...new Set(group.map((r) => r.date))].sort().reverse();
        const hourly = hourlyRows.filter(
          (r) => keyOf(r) === key && r.date === expanded?.date,
        );
        return (
          <article key={key} className="space-y-4">
            <h2 className="font-semibold">
              Mellow {platform === 'ios' ? 'iOS' : '安卓'} · {buyer} ·{' '}
              {REPORT_CHANNEL_NAMES[channel] || channel}
            </h2>
            {table(group, dates, false)}
            {expanded?.group === key && (
              <div className="space-y-3 rounded-xl bg-slate-50 p-4">
                <div className="flex justify-between gap-3">
                  <h3 className="font-semibold">
                    {expanded.date} · 东八区分小时行为
                  </h3>
                  <button
                    className="text-sm text-blue-600"
                    onClick={() => setExpanded(undefined)}
                  >
                    收起小时明细
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  各小时独立去重，分母固定为当天 D0
                  首开样本。同一人跨小时会重复出现，不能把各小时人数相加作为日去重人数。按事件发生时间统计，不要求顺序完成。
                </p>
                {busy ? (
                  <p role="status" className="text-sm text-blue-600">
                    正在加载小时数据…
                  </p>
                ) : hourly.length ? (
                  table(
                    hourly,
                    Array.from({ length: 24 }, (_, i) => String(i)),
                    true,
                  )
                ) : (
                  <p className="text-sm text-slate-500">
                    小时数据尚未返回；如读取失败，请查看上方错误提示。
                  </p>
                )}
              </div>
            )}
          </article>
        );
      })}
      {!groups.size && (
        <p className="py-12 text-center text-sm text-slate-500">
          选择日期后查询应用内行为数据
        </p>
      )}
    </div>
  );
}
