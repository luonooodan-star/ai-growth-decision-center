import { endOfWeek, startOfWeek, subDays, subWeeks } from 'date-fns';

export type PaidGrowthPreset = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek';

export function shanghaiCalendarToday(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(value('year'), value('month') - 1, value('day'));
}

export function paidGrowthQuickRange(
  preset: PaidGrowthPreset,
  today = shanghaiCalendarToday(),
): { from: Date; to: Date } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const yesterday = subDays(today, 1);
      return { from: yesterday, to: yesterday };
    }
    case 'thisWeek':
      return { from: startOfWeek(today, { weekStartsOn: 1 }), to: today };
    case 'lastWeek': {
      const lastWeek = subWeeks(today, 1);
      return {
        from: startOfWeek(lastWeek, { weekStartsOn: 1 }),
        to: endOfWeek(lastWeek, { weekStartsOn: 1 }),
      };
    }
  }
}
