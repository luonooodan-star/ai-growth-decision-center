import { useEffect, useState } from 'react';
import { getBiDay } from '@/api/paid-growth';
import type { BiDay } from '@shared/paid-growth.interface';
import { biSummary, trendTickIndexes } from '@shared/bi-summary';
import { Button } from '@/components/ui/button';

type Scope = {
  start: string;
  end: string;
  appId?: string;
  media?: string;
  refresh: boolean;
  revision: number;
};
const shift = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const money = (v: number | null) =>
  v === null
    ? '—'
    : '$' + v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });

/** Port of paid-growth-bi's Trend: retain its controls and gap-aware plotting. */
export function BiTrend({
  scope,
  target,
  wings,
}: {
  scope: Scope | null;
  target: number | null;
  wings: boolean;
}) {
  const [range, setRange] = useState<'period' | 'seven'>('period');
  const [metric, setMetric] = useState<'roas' | 'spend' | 'cost'>('roas');
  const [excludeToday, setExcludeToday] = useState(false);
  const [days, setDays] = useState<Record<string, BiDay>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!scope) return;
    const abort = new AbortController();
    setDays({});
    setError('');
    setLoading(true);
    const first = range === 'seven' ? shift(scope.end, -6) : scope.start;
    void (async () => {
      try {
        for (let date = first; date <= scope.end; date = shift(date, 1)) {
          const day = await getBiDay(
            {
              date,
              level: 'overall',
              appId: scope.appId,
              media: scope.media,
              refresh: scope.refresh ? '1' : undefined,
            },
            abort.signal,
          );
          if (abort.signal.aborted) return;
          setDays((old) => ({ ...old, [date]: day }));
        }
      } catch {
        if (!abort.signal.aborted)
          setError('趋势读取未完成，请重新查询；缺失日期不补零。');
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [scope, range]);
  const points: {
    date: string;
    row: ReturnType<typeof biSummary> | null;
    stale: boolean;
  }[] = [];
  if (scope)
    for (
      let date = range === 'seven' ? shift(scope.end, -6) : scope.start;
      date <= scope.end;
      date = shift(date, 1)
    ) {
      const d = days[date];
      points.push({
        date,
        row: d ? biSummary([d]) : null,
        stale:
          !!d &&
          [d.daily, d.revenue, d.events].some((p) => p.state === 'stale'),
      });
    }
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Shanghai',
  });
  const visible = excludeToday
    ? points.filter((p) => p.date !== today)
    : points;
  const label =
    metric === 'roas'
      ? 'D0 ROAS'
      : metric === 'spend'
        ? '媒体消耗'
        : wings
          ? 'eCPM'
          : 'D0 事件成本';
  const value = (row: ReturnType<typeof biSummary> | null) =>
    !row
      ? null
      : metric === 'roas'
        ? row.d0Roas
        : metric === 'spend'
          ? row.spend
          : wings
            ? null
            : row.eventCost;
  const format = (v: number | null) =>
    v === null ? '—' : metric === 'roas' ? v.toFixed(2) + '%' : money(v);
  const chartTarget = metric === 'roas' ? target : null;
  const max =
    Math.max(0.02, chartTarget ?? 0, ...visible.map((p) => value(p.row) ?? 0)) *
    1.15;
  const ticks = new Set(trendTickIndexes(visible.length));
  const coords = visible.map((p, i) => ({
    x:
      visible.length === 1
        ? 355
        : 55 + (i * 600) / Math.max(1, visible.length - 1),
    y: value(p.row) === null ? null : 205 - (value(p.row)! / max) * 170,
  }));
  const lines: string[] = [];
  let part = '';
  coords.forEach((c) => {
    if (c.y === null) {
      if (part) lines.push(part);
      part = '';
    } else part += (part ? ' ' : '') + c.x + ',' + c.y;
  });
  if (part) lines.push(part);
  const spendList = (
    <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(78px,1fr))] gap-3 border-t pt-3">
      {points.map((p) => (
        <div key={p.date}>
          <small className="block text-slate-500">
            {p.date.slice(5)} 消耗{p.stale ? ' · 旧缓存' : ''}
          </small>
          <b className="text-sm">{money(p.row?.spend ?? null)}</b>
        </div>
      ))}
    </div>
  );
  return (
    <section className="rounded-2xl border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-slate-400">RETURN TREND</p>
          <h2 className="mt-1 font-semibold">投放趋势</h2>
        </div>
        <span className="text-xs text-slate-500">
          ROAS 虚线为所选产品/渠道标准；多产品不混用目标
        </span>
      </div>
      <div className="my-3 flex flex-wrap items-center gap-2">
        {(['period', 'seven'] as const).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={range === r ? 'default' : 'outline'}
            aria-pressed={range === r}
            onClick={() => setRange(r)}
          >
            {r === 'period' ? '所选区间' : '近7日'}
          </Button>
        ))}
        <span className="text-xs text-slate-500">
          {points[0]?.date} ～ {scope?.end}
          {loading ? ' · 加载中' : ''}
        </span>
      </div>
      <div className="flex gap-2">
        {(
          [
            ['roas', 'D0 ROAS'],
            ['spend', '媒体消耗'],
            ['cost', wings ? 'eCPM' : 'D0 事件成本'],
          ] as const
        ).map(([k, l]) => (
          <Button
            key={k}
            size="sm"
            variant={metric === k ? 'default' : 'ghost'}
            aria-pressed={metric === k}
            onClick={() => setMetric(k)}
          >
            {l}
          </Button>
        ))}
      </div>
      {points.some((p) => p.date === today) && (
        <div className="my-2 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={excludeToday}
            onClick={() => setExcludeToday((v) => !v)}
          >
            {excludeToday ? '恢复含今日' : '排除今日查看'}
          </Button>
          <small className="text-slate-500">
            仅影响趋势；今日未完结，历史数据也可能回补。
          </small>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-700">
          {error}
        </p>
      )}
      {!scope ? (
        <p className="py-16 text-center text-slate-500">查询数据后展示趋势</p>
      ) : wings && metric === 'cost' ? (
        <p className="py-16 text-center text-slate-500">
          eCPM 未接入：需要对应的变现广告收入和广告展示量，不能以买量 CPM 代替。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <svg
            className="mx-auto w-full min-w-[520px] max-h-80"
            viewBox="0 0 710 258"
            role="img"
            aria-label={`${label}趋势，缺失日期留空`}
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1="55"
                  x2="655"
                  y1={205 - f * 170}
                  y2={205 - f * 170}
                  stroke="#edf1f7"
                />
                <text
                  x="47"
                  y={210 - f * 170}
                  textAnchor="end"
                  fill="#8190a4"
                  fontSize="11"
                >
                  {metric === 'roas'
                    ? (f * max).toFixed(0) + '%'
                    : money(f * max)}
                </text>
              </g>
            ))}
            {chartTarget !== null && (
              <line
                x1="55"
                x2="655"
                y1={205 - (chartTarget / max) * 170}
                y2={205 - (chartTarget / max) * 170}
                stroke="#94a3b8"
                strokeDasharray="5 5"
              />
            )}
            {lines.map((line, i) => (
              <polyline
                key={i}
                points={line}
                fill="none"
                stroke="#2563eb"
                strokeWidth="2.8"
                strokeLinejoin="round"
              />
            ))}
            {visible.map((p, i) => (
              <g key={p.date}>
                <title>
                  {p.date} · {label} {format(value(p.row))} · 消耗{' '}
                  {money(p.row?.spend ?? null)}
                  {p.stale ? ' · 旧缓存' : ''}
                </title>
                {ticks.has(i) && (
                  <text
                    x={coords[i].x}
                    y="239"
                    textAnchor="middle"
                    fill="#8190a4"
                    fontSize="11"
                  >
                    {p.date.slice(5)}
                  </text>
                )}
                {coords[i].y !== null ? (
                  <g>
                    <circle
                      cx={coords[i].x}
                      cy={coords[i].y!}
                      r="4.5"
                      fill="white"
                      stroke={p.stale ? '#cc982c' : '#2563eb'}
                      strokeWidth="2.5"
                    />
                    {visible.length <= 8 && (
                      <text
                        x={coords[i].x}
                        y={coords[i].y! - 12}
                        textAnchor="middle"
                        fontSize="12"
                        fill="#334966"
                      >
                        {format(value(p.row))}
                      </text>
                    )}
                  </g>
                ) : (
                  <text
                    x={coords[i].x}
                    y="200"
                    textAnchor="middle"
                    fontSize="11"
                    fill="#8190a4"
                  >
                    {loading && !p.row ? '待返回' : '缺失/不适用'}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      )}
      {points.length > 7 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-slate-500">
            查看 {points.length} 天的单日消耗
          </summary>
          {spendList}
        </details>
      ) : (
        spendList
      )}
    </section>
  );
}
