import { useState } from 'react';
import { format, subDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import {
  REPORT_BUYERS,
  REPORT_CHANNEL_NAMES,
  reportChannels,
} from '@shared/reference-report-filters';
export interface ReferenceFilterValue {
  platform: 'all' | 'android' | 'ios';
  buyer: string;
  channel: string;
  from: Date;
  to: Date;
}
const field =
  'h-[42px] w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800';
const btn =
  'h-[42px] rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-600';
export default function ReferenceReportFilters({
  value,
  change,
  min,
  max,
}: {
  value: ReferenceFilterValue;
  change: (v: ReferenceFilterValue) => void;
  min: Date;
  max: Date;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<DateRange>();
  const preset = (days?: number) =>
    setDraft({
      from: days
        ? new Date(Math.max(min.getTime(), subDays(max, days - 1).getTime()))
        : min,
      to: max,
    });
  return (
    <>
      <section className="grid items-end gap-4 rounded-2xl border border-slate-200 bg-white p-[22px] sm:grid-cols-3 xl:grid-cols-[1.15fr_1fr_1fr_2fr_auto]">
        <label className="grid gap-2 text-xs font-semibold text-slate-500">
          产品
          <select
            className={field}
            value={value.platform}
            onChange={(e) =>
              change({
                ...value,
                platform: e.target.value as ReferenceFilterValue['platform'],
              })
            }
          >
            <option value="all">所有产品</option>
            <option value="android">Mellow 安卓</option>
            <option value="ios">Mellow iOS</option>
          </select>
        </label>
        <label className="grid gap-2 text-xs font-semibold text-slate-500">
          投放人员
          <select
            className={field}
            value={value.buyer}
            onChange={(e) => {
              const buyer = e.target.value;
              change({
                ...value,
                buyer,
                channel: reportChannels(buyer).includes(value.channel)
                  ? value.channel
                  : '',
              });
            }}
          >
            <option value="">全部人员</option>
            {REPORT_BUYERS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-xs font-semibold text-slate-500">
          渠道
          <select
            className={field}
            value={value.channel}
            onChange={(e) => change({ ...value, channel: e.target.value })}
          >
            <option value="">全部渠道</option>
            {reportChannels(value.buyer).map((c) => (
              <option key={c} value={c}>
                {REPORT_CHANNEL_NAMES[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-xs font-semibold text-slate-500">
          安装日期范围
          <button
            aria-haspopup="dialog"
            className={field}
            onClick={() => {
              setDraft({ from: value.from, to: value.to });
              setOpen(true);
            }}
          >
            {format(value.from, 'yyyy-MM-dd')} →{' '}
            {format(value.to, 'yyyy-MM-dd')}
          </button>
        </label>
        <button
          className={btn}
          onClick={() =>
            change({
              platform: 'all',
              buyer: '',
              channel: '',
              from: min,
              to: max,
            })
          }
        >
          重置筛选
        </button>
      </section>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-3"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reference-date-title"
            className="max-h-[95vh] w-[690px] max-w-full overflow-auto rounded-2xl border bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          >
            <div className="flex items-center justify-between">
              <h2 id="reference-date-title" className="text-lg font-semibold">
                选择安装日期范围
              </h2>
              <button
                autoFocus
                className={btn}
                aria-label="关闭日期选择"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              先选开始日期，再选结束日期。
            </p>
            <div className="my-4 flex flex-wrap gap-2">
              <button className={btn} onClick={() => preset()}>
                全部日期
              </button>
              <button className={btn} onClick={() => preset(7)}>
                最近 7 个数据日
              </button>
              <button className={btn} onClick={() => preset(30)}>
                最近 30 个数据日
              </button>
            </div>
            <Calendar
              mode="range"
              numberOfMonths={2}
              weekStartsOn={1}
              defaultMonth={value.from}
              selected={draft}
              disabled={{ before: min, after: max }}
              onDayClick={(day) => {
                if (!draft?.from || draft.to) setDraft({ from: day });
                else
                  setDraft({
                    from: day < draft.from ? day : draft.from,
                    to: day < draft.from ? draft.from : day,
                  });
              }}
            />
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <span className="text-xs text-slate-500">
                {draft?.from
                  ? `${format(draft.from, 'yyyy-MM-dd')} → ${draft.to ? format(draft.to, 'yyyy-MM-dd') : '请选择结束日期'}`
                  : '请选择开始日期'}
              </span>
              <div className="flex gap-2">
                <button className={btn} onClick={() => setOpen(false)}>
                  取消
                </button>
                <button
                  className="h-[42px] rounded-lg bg-blue-600 px-4 text-sm text-white disabled:opacity-50"
                  disabled={!draft?.from || !draft.to}
                  onClick={() => {
                    if (draft?.from && draft.to) {
                      change({ ...value, from: draft.from, to: draft.to });
                      setOpen(false);
                    }
                  }}
                >
                  应用范围
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
