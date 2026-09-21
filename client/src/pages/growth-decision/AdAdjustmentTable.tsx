import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdjustmentNode } from '@shared/ad-adjustment.interface';
import { adjustmentSignal } from '@shared/ad-adjustment';
import type { MetricStandardProduct } from '@shared/metric-signals';
import type {
  MetaAdjustmentChange,
  MetaAdjustmentSnapshot,
} from '@shared/api.interface';
import { inspectAdjustment, adjustmentError } from '@/api/meta-adjustments';
import { AdjustmentRowEditor, type AdjustmentDrafts } from './AdjustmentEditor';
import type { AdjustmentDetail } from './useAdjustmentData';

export const adjustmentMoney = (v: number | null | undefined) =>
  v == null
    ? '—'
    : `$${v.toLocaleString('en-US', { maximumFractionDigits: 3, minimumFractionDigits: 2 })}`;
export const adjustmentPct = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toFixed(2)}%`;
export const adjustmentCount = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const colors = {
  good: 'bg-emerald-50 text-emerald-700',
  bad: 'bg-red-50 text-red-700',
  unknown: 'text-slate-400',
};
interface Props {
  details: Record<string, AdjustmentDetail>;
  loadDetail: (campaignId: string) => Promise<void>;
  drafts: AdjustmentDrafts;
  updateDraft: (
    snapshot: MetaAdjustmentSnapshot,
    patch: Partial<MetaAdjustmentChange> | null,
  ) => void;
  nodes: AdjustmentNode[];
  dates: string[];
  today: string;
  standards: MetricStandardProduct[];
}
export function AdAdjustmentTable({
  nodes,
  dates,
  today,
  standards,
  drafts,
  updateDraft,
  details,
  loadDetail,
}: Props) {
  const [editors, setEditors] = useState<
    Record<string, MetaAdjustmentSnapshot[]>
  >({});
  const [inspectError, setInspectError] = useState<Record<string, string>>({});
  const [inspecting, setInspecting] = useState<string | null>(null);
  const inspect = async (node: AdjustmentNode) => {
    setInspecting(node.key);
    setInspectError((old) => ({ ...old, [node.key]: '' }));
    try {
      const snapshots = await inspectAdjustment(
        {
          id: node.id,
          accountId: node.account.replace(/^act_/, ''),
          campaignId: node.campaignId,
          adsetId: node.adsetId,
          level:
            node.level === 'campaign'
              ? 'campaign'
              : node.level === 'adgroup'
                ? 'adset'
                : 'ad',
        },
        node.level === 'creative',
      );
      setEditors((old) => ({ ...old, [node.key]: snapshots }));
      if (!snapshots.length)
        setInspectError((old) => ({
          ...old,
          [node.key]: '素材未映射到真实广告，不能执行启停',
        }));
    } catch (error) {
      setInspectError((old) => ({
        ...old,
        [node.key]: adjustmentError(error),
      }));
    } finally {
      setInspecting(null);
    }
  };
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpanded(new Set());
  }, [today]);
  const toggle = (key: string) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const rows = (items: AdjustmentNode[], depth = 0): React.ReactNode =>
    items.map((node) => {
      const m = node.days[today],
        open = expanded.has(node.key);
      const products = standards.filter(
        (p) =>
          p.dorisAppId === node.appId &&
          p.channel.toLowerCase() === node.media.toLowerCase(),
      );
      const product = products.length === 1 ? products[0] : undefined;
      const background =
        depth === 0
          ? 'bg-white'
          : depth === 1
            ? 'bg-slate-50'
            : 'bg-blue-50/50';
      return (
        <RowGroup
          key={node.key}
          row={
            <TableRow className={background}>
              <TableCell
                className={`sticky left-0 z-10 min-w-80 max-w-[420px] border-r border-slate-100 ${depth ? 'bg-slate-50' : 'bg-white'}`}
              >
                <div style={{ paddingLeft: depth * 18 }}>
                  <button
                    type="button"
                    disabled={
                      !node.children.length &&
                      !(depth === 0 && /^\d+$/.test(node.campaignId))
                    }
                    onClick={() => {
                      toggle(node.key);
                      if (!open && depth === 0)
                        void loadDetail(node.campaignId);
                    }}
                    aria-expanded={
                      depth === 0 || node.children.length ? open : undefined
                    }
                    className="flex w-full items-start gap-2 text-left font-semibold text-slate-800 hover:text-blue-600 disabled:hover:text-slate-800"
                  >
                    {depth === 0 || node.children.length ? (
                      open ? (
                        <ChevronDown className="mt-0.5 size-4 shrink-0" />
                      ) : (
                        <ChevronRight className="mt-0.5 size-4 shrink-0" />
                      )
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <span className="whitespace-normal break-words">
                      {node.name}
                    </span>
                  </button>
                  <div className="ml-6 mt-1 space-y-1 text-[11px] text-slate-500">
                    <p>
                      {depth === 0 ? '系列' : depth === 1 ? '广告组' : '素材'}{' '}
                      ID：{node.id || '未返回'}
                    </p>
                    {depth === 0 && (
                      <p className="whitespace-normal">
                        {node.appName} · {node.media} · 账户 {node.account}
                      </p>
                    )}
                    {depth === 0 && product && node.campaignId && (
                      <Link
                        className="text-blue-600"
                        to={`/products/${product.id}?campaignId=${encodeURIComponent(node.campaignId)}`}
                      >
                        进入决策中心 →
                      </Link>
                    )}
                  </div>
                  <div className="ml-6 mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        !!inspecting ||
                        node.media.toLowerCase() !== 'facebook' ||
                        !/^\d+$/.test(node.account.replace(/^act_/, '')) ||
                        !/^\d+$/.test(node.id)
                      }
                      onClick={() => void inspect(node)}
                    >
                      {inspecting === node.key
                        ? '读取 Meta 状态'
                        : '启停 / 预算调整'}
                    </Button>
                    {inspectError[node.key] && (
                      <p
                        role="alert"
                        className="mt-2 whitespace-normal text-red-600"
                      >
                        {inspectError[node.key]}
                      </p>
                    )}
                    {editors[node.key] && (
                      <AdjustmentRowEditor
                        snapshots={editors[node.key]}
                        drafts={drafts}
                        update={updateDraft}
                      />
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right font-semibold">
                {adjustmentMoney(m.spend)}
              </TableCell>
              <TableCell className="text-right">
                {adjustmentCount(m.installs)}
              </TableCell>
              <TableCell className="text-right">
                {adjustmentMoney(m.cpm)}
              </TableCell>
              <TableCell className="text-right">
                {adjustmentMoney(m.cpi)}
              </TableCell>
              <TableCell className="text-right">
                {adjustmentPct(m.ctr)}
              </TableCell>
              <TableCell className="text-right">
                {adjustmentPct(m.cvr)}
              </TableCell>
              <TableCell
                className="text-right text-slate-400"
                title="变现 eCPM 缺少系列级广告展示和收入归因，不能使用买量 CPM 代替"
              >
                —
              </TableCell>
              <TableCell className="text-right font-semibold">
                {adjustmentMoney(m.revenue)}
              </TableCell>
              {dates.map((date) => {
                const signal = adjustmentSignal(node, date, standards);
                return (
                  <TableCell key={date} className="text-right">
                    <span
                      title={signal.label}
                      className={`rounded px-2 py-1 font-semibold ${colors[signal.state]}`}
                    >
                      {adjustmentPct(node.days[date]?.roas)}
                    </span>
                  </TableCell>
                );
              })}
            </TableRow>
          }
          childrenRows={
            open ? (
              <>
                {depth === 0 &&
                  (details[node.campaignId]?.loading ||
                    details[node.campaignId]?.error ||
                    !node.children.length) && (
                    <TableRow>
                      <TableCell
                        colSpan={12}
                        className="bg-slate-50 p-3 text-sm text-slate-500"
                      >
                        {details[node.campaignId]?.loading
                          ? '该系列明细加载中（先今天，再历史）…'
                          : details[node.campaignId]?.error ||
                            (details[node.campaignId]
                              ? '该系列当前筛选下无可用明细'
                              : '明细未加载或缓存已释放')}
                        {!details[node.campaignId]?.loading && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void loadDetail(node.campaignId)}
                          >
                            重新加载明细
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                {rows(node.children, depth + 1)}
              </>
            ) : null
          }
        />
      );
    });
  return (
    <>
      <div className="flex justify-end border-t px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(new Set())}
        >
          收起全部
        </Button>
      </div>
      <Table
        containerClassName="max-h-[70vh] overflow-auto"
        className="border-separate border-spacing-0 text-xs"
      >
        <TableHeader className="sticky top-0 z-30 bg-slate-100">
          <TableRow>
            <TableHead className="sticky left-0 z-20 bg-slate-100">
              系列 / 广告组 / 素材
            </TableHead>
            {[
              '消耗 ↓',
              '媒体安装',
              'CPM',
              'CPI',
              'CTR',
              '安装 CVR',
              'eCPM',
              'D0 收入',
            ].map((label) => (
              <TableHead key={label} className="text-right">
                {label}
              </TableHead>
            ))}
            {dates.map((date, i) => (
              <TableHead key={date} className="text-right">
                {['前天', '昨天', '今天'][i]} D0 ROAS
                <p className="text-[10px] font-normal text-slate-500">{date}</p>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows(nodes)}
          {!nodes.length && (
            <TableRow>
              <TableCell
                colSpan={12}
                className="py-12 text-center text-slate-500"
              >
                暂无符合条件的当天数据；可清除筛选或刷新重试。
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <p className="border-t p-3 text-xs text-slate-500">
        共 {nodes.length} 个系列 · 全部展示，无分页 · 点击名称按层级展开 ·
        缺失值显示 —，不作为 0 或未达标
      </p>
    </>
  );
}
function RowGroup({
  row,
  childrenRows,
}: {
  row: React.ReactNode;
  childrenRows: React.ReactNode;
}) {
  return (
    <>
      {row}
      {childrenRows}
    </>
  );
}
