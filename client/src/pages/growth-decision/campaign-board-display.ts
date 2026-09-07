import type { CampaignVerdict } from '@shared/api.interface';
export const LABELS: Record<CampaignVerdict, string> = {
  increase: '建议加量',
  decrease: '建议减量',
  adjust_ads: '调整广告',
  observe: '继续观察',
  normal: '正常投放',
};
export const COLORS: Record<CampaignVerdict, string> = {
  increase: 'bg-emerald-50 text-emerald-700',
  decrease: 'bg-rose-50 text-rose-700',
  adjust_ads: 'bg-violet-50 text-violet-700',
  observe: 'bg-amber-50 text-amber-800',
  normal: 'bg-slate-100 text-slate-600',
};
export const metric = (key: string, value?: number): string => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (['d0_roas', 'roas', 'ctr'].includes(key))
    return `${(value * 100).toFixed(2)}%`;
  if (['spend', 'cpi', 'ecpm'].includes(key))
    return `$${value.toFixed(key === 'spend' ? 2 : 3)}`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
};
