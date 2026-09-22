import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { metaEventStatusLabel } from '@shared/meta-targets';
import type {
  MetaOperationOverview,
  MetaOperationCategory,
  CampaignDailySnapshot,
} from '@shared/api.interface';
import { getMetaOperations, saveOperationReason } from '@/api/meta-operations';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const LABELS: Record<MetaOperationCategory, string> = {
  increase: '已执行加量',
  decrease: '已执行减量',
  pause: '停投观察',
  adjust: '调整后观察',
  other: '其他审计记录',
};
const metric = (v?: number, percent = false): string =>
  v === undefined ? '—' : percent ? `${(v * 100).toFixed(2)}%` : v.toFixed(2);
const Day = ({ row }: { row: CampaignDailySnapshot }) => (
  <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
    <span>{row.dataDate}</span>
    <span>消耗 ${metric(row.metrics.spend)}</span>
    <span>CPI ${metric(row.metrics.cpi)}</span>
    <span>D0 {metric(row.metrics.d0_roas, true)}</span>
    {!!row.qualityIssues.length && (
      <span className="text-amber-700">完整性待核对</span>
    )}
  </div>
);

export default function MetaOperationsPage() {
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [data, setData] = useState<MetaOperationOverview | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<MetaOperationCategory | 'all'>('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    getMetaOperations(page)
      .then((result) => {
        if (active) {
          setData(result);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('操作记录加载失败，请检查服务连接后重试');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [page, refresh]);
  return (
    <div className="mx-auto max-w-[1540px] space-y-6 px-5 py-8 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">操作与效果复盘</h1>
          <p className="mt-2 text-sm text-slate-500">
            广告调整页执行记录 × 提交时快照 × Doris 后续结果。自动留档，无需 MCP
            补录。
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw className="size-4" />
          刷新记录
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}
      <p className="rounded-xl border bg-white p-4 text-sm text-slate-600">
        {data?.lastImportAt
          ? `最近接收 ${new Date(data.lastImportAt).toLocaleString('zh-CN')} · 共 ${data.total} 条`
          : '暂无成功执行的调整记录。通过广告调整页提交并成功执行后自动进入复盘。'}{' '}
        历史导入记录保留；在 Meta
        后台直接操作的变更不会自动记录。调整当日不参与前后完整日对照。
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          className="rounded-lg border px-3 py-2 text-sm text-blue-600"
          to="/skills"
        >
          每周 Skill 复盘 →
        </Link>
        <Button
          variant={conflictsOnly ? 'default' : 'outline'}
          onClick={() => setConflictsOnly(!conflictsOnly)}
        >
          本页仅看建议分歧
        </Button>
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          本页全部
        </Button>
        {(Object.keys(LABELS) as MetaOperationCategory[]).map((key) => (
          <Button
            key={key}
            variant={filter === key ? 'default' : 'outline'}
            onClick={() => setFilter(key)}
          >
            {LABELS[key]}
          </Button>
        ))}
      </div>
      {busy && <p>加载中…</p>}
      {!busy && data && !data.items.length && (
        <p className="rounded-xl border bg-white p-8 text-slate-500">
          没有已同步记录；不会生成模拟操作或虚构复盘结论。
        </p>
      )}
      {data?.items
        .filter((r) => !conflictsOnly || r.decision?.state === 'conflict')
        .sort(
          (a, b) =>
            Number(b.decision?.state === 'conflict') -
            Number(a.decision?.state === 'conflict'),
        )
        .filter((r) => filter === 'all' || r.operation.category === filter)
        .map((review) => {
          const op = review.operation;
          return (
            <section
              key={op.id}
              className="space-y-4 rounded-xl border bg-white p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{LABELS[op.category]}</Badge>
                <span className="text-sm text-slate-500">
                  {op.actorName} ·{' '}
                  {new Date(op.occurredAt).toLocaleString('zh-CN')}
                </span>
                {!op.linked && <Badge variant="outline">归属待确认</Badge>}
              </div>
              <h2 className="break-words font-semibold">
                {op.campaignName || op.objectName}
              </h2>
              <p className="text-xs text-slate-500">
                账户 {op.accountId} · {op.objectLevel} {op.objectName} ·{' '}
                {op.objectId}
              </p>
              <p className="text-sm">
                {op.eventType}：{String(op.before ?? '未返回')} →{' '}
                {String(op.after ?? '未返回')}
                {op.changePct !== undefined &&
                  `（${op.changePct > 0 ? '+' : ''}${op.changePct.toFixed(1)}%）`}
              </p>
              <p className="text-xs text-slate-500">
                来源：
                {op.source === 'adjustment_page'
                  ? '广告调整页'
                  : '历史 Meta 导入'}
                。预算为 Meta 最小货币单位。目标：
                {op.objective || '未返回'} · 优化：
                {op.optimizationGoal || '日志未记录'} · 事件：
                {op.conversionEvent || '日志未记录'}
              </p>
              {op.source === 'adjustment_page' && (
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
                  <p>
                    提交时证据：
                    {op.capturedEvidence?.note ||
                      '历史任务未保存 Doris 快照，不倒填。'}
                  </p>
                  {op.capturedEvidence?.baseline && (
                    <p className="mt-1">
                      数据日 {op.capturedEvidence.baseline.dataDate} · 抓取于{' '}
                      {new Date(
                        op.capturedEvidence.baseline.fetchedAt,
                      ).toLocaleString('zh-CN')}{' '}
                      · 消耗 {op.capturedEvidence.baseline.metrics.spend ?? '—'}{' '}
                      · D0 ROAS{' '}
                      {op.capturedEvidence.baseline.metrics.d0_roas ===
                      undefined
                        ? '—'
                        : (
                            op.capturedEvidence.baseline.metrics.d0_roas * 100
                          ).toFixed(2) + '%'}
                      {op.capturedEvidence.baseline.qualityIssues.length
                        ? ' · ' +
                          op.capturedEvidence.baseline.qualityIssues.join('；')
                        : ''}
                    </p>
                  )}
                  <p className="mt-1 text-xs">
                    新任务同时记录决策中心用户名与 Meta
                    执行身份；旧共用授权记录无法追溯到具体优化师。
                  </p>
                </div>
              )}
              {op.currentTargets && (
                <p className="mt-2 text-xs text-slate-500">
                  当前设置（非操作时历史值）：系列目标{' '}
                  {op.currentTargets.objectives.join(' / ') || '待同步'} ·
                  优化目标{' '}
                  {op.currentTargets.optimizationGoals.join(' / ') || '待同步'}{' '}
                  · 转化事件{' '}
                  {op.currentTargets.conversionEvents.join(' / ') ||
                    metaEventStatusLabel[op.currentTargets.eventStatus]}
                  {op.currentTargets.fetchedAt &&
                    ` · 获取于 ${new Date(op.currentTargets.fetchedAt).toLocaleString('zh-CN')}`}
                </p>
              )}
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {review.summary}
              </p>
              {review.decision && (
                <div
                  className={`rounded-lg p-3 text-sm ${review.decision.state === 'conflict' ? 'border border-red-200 bg-red-50 text-red-800' : 'bg-slate-50 text-slate-600'}`}
                >
                  <p className="font-medium">
                    {review.decision.state === 'conflict'
                      ? '建议分歧 · 优先复盘'
                      : review.decision.state === 'aligned'
                        ? '操作方向一致'
                        : '历史建议不足'}
                  </p>
                  <p>{review.decision.explanation}</p>
                  {review.decision.recommendation && (
                    <p className="mt-2">
                      操作前建议：{review.decision.recommendation.action} ·
                      记录于{' '}
                      {new Date(
                        review.decision.recommendation.recordedAt,
                      ).toLocaleString('zh-CN')}{' '}
                      · 规则{' '}
                      {review.decision.recommendation.rule?.name || '默认判断'}
                    </p>
                  )}
                  <details className="mt-2">
                    <summary className="cursor-pointer">
                      补充人工判断理由（可选，不阻塞自动记录）
                    </summary>
                    <Textarea
                      aria-label="人工调整理由"
                      className="mt-2 bg-white"
                      maxLength={2000}
                      value={
                        reasons[op.id] ?? review.decision.humanReason ?? ''
                      }
                      onChange={(e) =>
                        setReasons({ ...reasons, [op.id]: e.target.value })
                      }
                    />
                    <Button
                      className="mt-2"
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await saveOperationReason(
                            op.id,
                            reasons[op.id] ??
                              review.decision?.humanReason ??
                              '',
                          );
                          setRefresh((v) => v + 1);
                        } catch {
                          setError('理由保存失败，请填写有效内容后重试');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      保存理由并留档
                    </Button>
                  </details>
                </div>
              )}
              <details>
                <summary className="cursor-pointer text-sm font-medium text-blue-600">
                  查看操作前后数据与证据
                </summary>
                <p className="my-3 text-xs text-slate-500">
                  Doris 日界：{review.dataTimezone}
                  ；对照范围为广告系列。广告组／广告操作不等于已取得该对象的
                  D0。
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <h3>调整前最近 3 日</h3>
                    {review.before.map((s) => (
                      <Day key={s.dataDate} row={s} />
                    ))}
                    {!review.before.length && <p>尚无匹配快照</p>}
                  </div>
                  <div className="space-y-2">
                    <h3>调整后 7 日内完整日</h3>
                    {review.after.map((s) => (
                      <Day key={s.dataDate} row={s} />
                    ))}
                    {!review.after.length && <p>等待完整数据日</p>}
                  </div>
                </div>
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs">
                  {op.raw}
                </pre>
              </details>
              {op.productId && op.campaignId && (
                <Link
                  className="text-sm text-blue-600"
                  to={`/products/${op.productId}?campaignId=${encodeURIComponent(op.campaignId)}`}
                >
                  进入对应广告系列决策 →
                </Link>
              )}
            </section>
          );
        })}
      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          disabled={busy || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          上一页
        </Button>
        <span className="text-sm">第 {page} 页 · 每页 50 条</span>
        <Button
          variant="outline"
          disabled={busy || page * 50 >= (data?.total || 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
