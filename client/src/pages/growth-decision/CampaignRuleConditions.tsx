import React from 'react';
import type { CampaignDecisionRule } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
type Condition = CampaignDecisionRule['conditions'][number];
const METRICS: Record<string, string> = {
  d0_roas: 'D0 ROAS（%）',
  cpi: 'CPI（$）',
  cpa: 'CPA（$）',
  ecpm: '买量 CPM（$）',
  ctr: 'CTR（%）',
  spend: '消耗（$）',
  adjust_installs: 'Adjust 安装',
  media_installs: '媒体安装',
  impressions: '展示',
  media_clicks: '点击',
  adjust_revenue: '收入（$）',
  roas: '当日 ROAS（%）',
  ipm: 'IPM',
  retention_d1: '次留（%）',
  ipu: 'IPU',
  arpu: 'ARPU（$）',
};
const multiplier = (c: Condition): number =>
  c.basis === 'value' &&
  ['d0_roas', 'roas', 'ctr', 'retention_d1'].includes(c.metric)
    ? 100
    : 1;

interface Props {
  selected: CampaignDecisionRule;
  edit: (changes: Partial<CampaignDecisionRule>) => void;
  editCondition: (index: number, changes: Partial<Condition>) => void;
}
export const CampaignRuleConditions: React.FC<Props> = ({
  selected,
  edit,
  editCondition,
}) => (
  <>
    {' '}
    <p className="text-sm font-medium">全部条件同时满足（AND）</p>
    <p className="text-xs text-slate-500">
      D0/CTR/次留等百分比指标直接填 70 表示 70%；环比填 -20 表示下降
      20%。无前一天数据、分母为 0 或指标缺失时不命中，缺失不当 0。
    </p>
    {selected.conditions.map((c, index) => (
      <div
        className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2"
        key={index}
      >
        <Select
          value={c.metric}
          onValueChange={(v) =>
            editCondition(index, {
              metric: v as Condition['metric'],
              value: NaN,
            })
          }
        >
          <SelectTrigger
            aria-label={`条件 ${index + 1} 指标`}
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(METRICS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={c.basis}
          onValueChange={(v) =>
            editCondition(index, {
              basis: v as Condition['basis'],
              value: NaN,
            })
          }
        >
          <SelectTrigger
            aria-label={`条件 ${index + 1} 比较依据`}
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="value">当日指标值</SelectItem>
            <SelectItem value="previous_day_change">
              较前一天变化（%）
            </SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={c.operator}
          onValueChange={(v) =>
            editCondition(index, {
              operator: v as Condition['operator'],
            })
          }
        >
          <SelectTrigger
            aria-label={`条件 ${index + 1} 运算符`}
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gte">大于等于 ≥</SelectItem>
            <SelectItem value="lte">小于等于 ≤</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Input
            aria-label={`条件 ${index + 1} 阈值`}
            type="number"
            value={
              Number.isFinite(c.value)
                ? Number((c.value * multiplier(c)).toFixed(8))
                : ''
            }
            placeholder="请输入阈值"
            onChange={(e) =>
              editCondition(index, {
                value:
                  e.target.value === ''
                    ? NaN
                    : Number(e.target.value) / multiplier(c),
              })
            }
          />
          <Button
            size="icon"
            variant="ghost"
            disabled={selected.conditions.length === 1}
            aria-label={`删除条件 ${index + 1}`}
            onClick={() =>
              edit({
                conditions: selected.conditions.filter((_, i) => i !== index),
              })
            }
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    ))}
    <Button
      size="sm"
      variant="outline"
      disabled={selected.conditions.length >= 8}
      onClick={() =>
        edit({
          conditions: [
            ...selected.conditions,
            {
              metric: 'spend',
              basis: 'value',
              operator: 'gte',
              value: NaN,
            },
          ],
        })
      }
    >
      添加条件
    </Button>
  </>
);
