import React from 'react';
import type { CampaignRulesPreview } from '@shared/api.interface';
import { LABELS } from './campaign-board-display';

export const CampaignRulePreview: React.FC<{
  preview: CampaignRulesPreview;
}> = ({ preview }) => (
  <section
    className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm"
    aria-label="规则试跑结果"
  >
    <h3 className="font-semibold">
      近 7 个数据日试跑：{preview.evaluated} 个系列日，{preview.changed} 个改判
    </h3>
    <p>
      优先处理标记：{preview.urgentBefore} → {preview.urgentAfter}
    </p>
    <p className="text-xs text-slate-600">
      使用当前保存的历史快照回放，不代表当时已知数据；不含历史执行单干扰，不预测收益。正式发布仍受当前数据与执行保护约束。
    </p>
    <div className="max-h-64 space-y-2 overflow-y-auto">
      {preview.items.map((item) => (
        <div
          key={`${item.key}-${item.date}`}
          className="rounded-lg bg-white p-2"
        >
          <p className="break-words">
            {item.date} · {item.name}
          </p>
          <p>
            {LABELS[item.before]} → {LABELS[item.after]} · 条件优先命中：
            {item.winner || '内置规则'}
          </p>
          {!!item.conflicts.length && (
            <p className="text-amber-800">
              多规则同时命中：{item.conflicts.join('、')}；按优先级及规则 ID
              取首项
            </p>
          )}
          {!!item.blockers.length && (
            <p className="text-slate-500">
              执行拦截：{item.blockers.join('；')}
            </p>
          )}
        </div>
      ))}
      {!preview.items.length && (
        <p>暂无历史快照，无法验证规则影响。请先抓取数据。</p>
      )}
    </div>
  </section>
);
