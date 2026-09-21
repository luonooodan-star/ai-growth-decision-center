import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BiRow } from '@shared/paid-growth.interface';
import type { MetaAdEntity } from '@shared/api.interface';
import { biRows } from '@shared/paid-growth';
import { adsetEvent } from '@shared/meta-targets';
import { getBiDay } from '@/api/paid-growth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '@/components/ui/table';

interface TrendDay {
  date: string;
  row?: BiRow;
  error?: string;
  updatedAt?: string;
}
const display = (value: number | null | undefined) =>
  value == null
    ? '—'
    : value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });

export function BiCampaignDetail({
  row,
  entities,
  endDate,
  productId,
  onClose,
}: {
  row: BiRow;
  entities: MetaAdEntity[];
  endDate: string;
  productId?: string;
  onClose: () => void;
}) {
  const [trend, setTrend] = useState<TrendDay[]>([]);
  const [loading, setLoading] = useState(true);
  const matching = useMemo(
    () =>
      row.media.toLowerCase() === 'facebook'
        ? entities.filter((e) => e.campaignId === row.campaignId)
        : [],
    [entities, row.campaignId, row.media],
  );
  const accounts = [...new Set(matching.map((e) => e.accountId))];
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      for (let i = 6; i >= 0; i--) {
        const date = new Date(Date.parse(endDate) - i * 86400000)
          .toISOString()
          .slice(0, 10);
        let item: TrendDay;
        try {
          const day = await getBiDay(
            {
              date,
              level: 'campaigns',
              appId: String(row.appId),
              media: row.media,
            },
            abort.signal,
          );
          item = {
            date,
            row: biRows([day]).find(
              (r) =>
                r.campaignId === row.campaignId &&
                r.appId === row.appId &&
                r.media === row.media,
            ),
            updatedAt: day.daily.updatedAt,
            error:
              [day.daily, day.revenue]
                .filter((p) => ['missing', 'stale'].includes(p.state))
                .map((p) => p.message || '数据缺失或缓存过期')
                .join('；') || undefined,
          };
        } catch (e) {
          if (abort.signal.aborted) return;
          item = { date, error: e instanceof Error ? e.message : '读取失败' };
        }
        if (abort.signal.aborted) return;
        setTrend((previous) => [...previous, item]);
      }
      if (!abort.signal.aborted) setLoading(false);
    })();
    return () => abort.abort();
  }, [row.appId, row.media, row.campaignId, endDate]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 break-all">
            {row.campaignName || row.label}
          </DialogTitle>
          <DialogDescription>
            归属与近 7 天历史数据 · 与投放明细口径一致，不生成分析结论
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
          <p>
            产品：{row.appName}（{row.appId}）
          </p>
          <p>渠道：{row.media}</p>
          <p className="break-all">Campaign ID：{row.campaignId || '未返回'}</p>
          <p className="break-all">
            Facebook Account ID：
            {row.media.toLowerCase() !== 'facebook'
              ? '不适用'
              : accounts.length === 1
                ? accounts[0]
                : accounts.length > 1
                  ? '存在多个账户映射，尚未唯一确认'
                  : '尚未同步账户归属'}
          </p>
        </div>
        {accounts.length === 1 && matching.some((e) => e.level === 'adset') && (
          <div className="max-h-40 overflow-auto rounded-xl border p-3 text-sm">
            <p className="mb-2 font-medium">广告组事件目标（当前 Meta 配置）</p>
            {matching
              .filter((e) => e.level === 'adset')
              .map((e) => (
                <p key={e.id} className="mb-2 break-all">
                  {e.name} · {e.id} · {adsetEvent(e) || '事件名称未返回'}
                  <span className="ml-2 text-xs text-slate-500">
                    同步于 {new Date(e.fetchedAt).toLocaleString('zh-CN')}
                  </span>
                </p>
              ))}
          </div>
        )}
        <p className="text-xs text-slate-500">
          截止 {endDate} 的近 7 天，按日串行读取并复用服务端缓存。空值不当作
          0；D0 为抓取时已入库数据。
          {loading ? `已返回 ${trend.length}/7 天…` : ''}
        </p>
        <Table containerClassName="max-h-80 overflow-auto">
          <TableHeader className="sticky top-0 bg-slate-50">
            <TableRow>
              {[
                '日期',
                '消耗 ($)',
                '安装',
                'CPI ($)',
                'CTR (%)',
                'CPM ($)',
                'D0 ROAS (%)',
                '状态',
              ].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {trend.map((d) => (
              <TableRow key={d.date}>
                <TableCell>{d.date}</TableCell>
                {(
                  ['spend', 'installs', 'cpi', 'ctr', 'cpm', 'd0Roas'] as const
                ).map((k) => (
                  <TableCell key={k} className="tabular-nums">
                    {display(d.row?.[k])}
                  </TableCell>
                ))}
                <TableCell className="max-w-56 whitespace-normal text-xs text-slate-500">
                  {d.error ||
                    (!d.row
                      ? '当日未返回该系列记录'
                      : d.row.missingDays
                        ? '部分指标未返回'
                        : '已返回')}
                  {d.updatedAt && (
                    <span className="block">
                      {new Date(d.updatedAt).toLocaleString('zh-CN')}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {productId && (
          <Link
            className="text-sm font-medium text-blue-600"
            to={`/products/${productId}?campaignId=${encodeURIComponent(row.campaignId || '')}`}
          >
            进入决策中心，深入分析 →
          </Link>
        )}
      </DialogContent>
    </Dialog>
  );
}
