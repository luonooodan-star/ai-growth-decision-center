import { memo } from 'react';
import { TableRow, TableCell } from '@/components/ui/table';
import type { BiDay } from '@shared/paid-growth.interface';
import { biChannelSpend, biSummary } from '@shared/bi-summary';
import { formatBiNumber as number } from './paid-growth-display';

const states = {
  fresh: '已更新',
  cached: '缓存',
  stale: '旧缓存',
  missing: '失败',
  unsupported: '不支持',
};
export const PaidGrowthDailyRow = memo(function PaidGrowthDailyRow({
  day,
  media,
  designer,
}: {
  day: BiDay;
  media: string;
  designer: boolean;
}) {
  const daily = biSummary([day]);
  const spend = media ? biChannelSpend([day], media) : daily.spend;
  const installs = daily.installs;
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{day.date}</TableCell>
      <TableCell className="text-xs">
        {(designer ? [day.daily] : [day.daily, day.revenue, day.events])
          .map((p) => states[p.state])
          .join(' / ')}
      </TableCell>
      <TableCell className="text-right tabular-nums">{number(spend)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {number(installs, 0)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {number(spend !== null && installs ? spend / installs : null, 3)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-slate-500">
        {day.daily.updatedAt
          ? new Date(day.daily.updatedAt).toLocaleString('zh-CN')
          : '未获取'}
      </TableCell>
    </TableRow>
  );
});
