import type { CampaignDecisionCard } from '@shared/api.interface';
import { Button } from '@/components/ui/button';

export type MetaFilter = {
  key: 'metaObjectives' | 'metaOptimizationGoals' | 'metaConversionEvents';
  value: string;
} | null;
export type MetaFilterItem = Pick<
  CampaignDecisionCard,
  'metaObjectives' | 'metaOptimizationGoals' | 'metaConversionEvents'
>;
export function CampaignMetaFilters({
  items,
  value,
  onChange,
}: {
  items: MetaFilterItem[];
  value: MetaFilter;
  onChange: (next: MetaFilter) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border bg-white p-4">
      <p className="text-sm font-medium">按 Meta 投放目标／事件筛选</p>
      {(
        [
          ['metaObjectives', '系列目标'],
          ['metaOptimizationGoals', '优化目标'],
          ['metaConversionEvents', '转化事件'],
        ] as const
      ).map(([key, label]) => {
        const options = [...new Set(items.flatMap((c) => c[key] || []))];
        return (
          <div className="flex flex-wrap items-center gap-2" key={key}>
            <span className="text-xs text-slate-500">{label}</span>
            {options.map((v) => (
              <Button
                size="sm"
                variant={
                  value?.key === key && value.value === v
                    ? 'default'
                    : 'outline'
                }
                key={v}
                onClick={() => onChange({ key, value: v })}
              >
                {v}
              </Button>
            ))}
            <Button
              size="sm"
              variant={
                value?.key === key && value.value === '__missing'
                  ? 'default'
                  : 'ghost'
              }
              onClick={() => onChange({ key, value: '__missing' })}
            >
              未返回
            </Button>
          </div>
        );
      })}
      {value && (
        <Button size="sm" variant="outline" onClick={() => onChange(null)}>
          清除目标筛选
        </Button>
      )}
      <p className="text-xs text-slate-500">
        使用已同步 Meta
        配置，不从名称推断。多个优化目标分别显示；未返回不代表未配置。可与现有队列筛选叠加。
      </p>
    </div>
  );
}
