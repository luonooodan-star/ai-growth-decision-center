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
      <p className="text-sm font-medium">按广告组事件目标筛选</p>
      {([['metaConversionEvents', '事件目标']] as const).map(([key, label]) => {
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
        使用广告组实际配置：install、purchase
        或具体自定义事件名。系列含多个事件时可分别命中；筛选系列不改变系列汇总数值。未返回不代表未配置，不从名称猜测。
      </p>
    </div>
  );
}
