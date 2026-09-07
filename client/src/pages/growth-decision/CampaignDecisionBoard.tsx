import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type {
  CampaignDecisionBoard as Board,
  CampaignDecisionCard,
  CampaignDecisionPolicy,
  CampaignVerdict,
  DecideCampaignRequest,
  GrowthDecisionCase,
} from '@shared/api.interface';
import * as api from '@/api/campaign-decision';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { CampaignExecutionHistory } from './CampaignExecutionHistory';
import { CampaignBoardOrders } from './CampaignBoardOrders';
import { CampaignBoardList } from './CampaignBoardList';
import { CampaignBoardDetail } from './CampaignBoardDetail';
import { CampaignRulesPanel } from './CampaignRulesPanel';

interface CampaignDecisionBoardProps {
  productId: string;
  refreshedAt?: string;
  onChanged: () => Promise<void>;
}

const POLICY_LABELS: Record<keyof CampaignDecisionPolicy, string> = {
  minSpend: '单日最低消耗（美元）',
  minInstalls: '单日最低 Adjust 安装',
  consecutiveDays: '连续达标／不达标天数',
  increasePct: '单次加量幅度（%，1～30）',
  decreasePct: '单次减量幅度（%，1～50）',
  reviewHours: '执行后复查（小时，24～168）',
};
function errorText(error: unknown): string {
  return axios.isAxiosError(error)
    ? String(
        error.response?.data?.error?.message ||
          error.response?.data?.message ||
          error.message,
      )
    : error instanceof Error
      ? error.message
      : '操作失败';
}

export const CampaignDecisionBoard: React.FC<CampaignDecisionBoardProps> = ({
  productId,
  refreshedAt,
  onChanged,
}) => {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<
    CampaignVerdict | 'actionable' | 'urgent' | 'all'
  >('actionable');
  const [search, setSearch] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [policy, setPolicy] = useState<CampaignDecisionPolicy | null>(null);
  const [decision, setDecision] = useState<{
    card: CampaignDecisionCard;
    type: DecideCampaignRequest['decision'];
  } | null>(null);
  const [reason, setReason] = useState('');
  const [budget, setBudget] = useState('');
  const [execution, setExecution] = useState<GrowthDecisionCase | null>(null);
  const [historyOrder, setHistoryOrder] = useState<GrowthDecisionCase | null>(
    null,
  );

  const loadSequence = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    try {
      const nextBoard = await api.getCampaignBoard(productId);
      if (sequence !== loadSequence.current) return;
      setBoard(nextBoard);
      setError('');
    } catch (e: unknown) {
      if (sequence !== loadSequence.current) return;
      setError(errorText(e));
    }
  }, [productId]);
  useEffect(() => {
    void load();
  }, [load, refreshedAt]);
  useEffect(() => {
    const timer: number = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  const run = async (
    action: () => Promise<unknown>,
    message: string,
  ): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await load();
      await onChanged();
    } catch (e: unknown) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const selected: CampaignDecisionCard | undefined = board?.items.find(
    (c) => c.key === detail,
  );
  const items: CampaignDecisionCard[] = (board?.items || []).filter(
    (c) =>
      (filter === 'all' ||
        (filter === 'actionable'
          ? c.verdict !== 'normal'
          : filter === 'urgent'
            ? Boolean(c.urgent)
            : c.verdict === filter)) &&
      [
        c.snapshot.campaignName,
        c.snapshot.campaignId,
        c.snapshot.accountId,
        ...c.snapshot.countries,
      ]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const orders: GrowthDecisionCase[] = (board?.items || [])
    .flatMap((c) => c.recentOrders)
    .filter(
      (o) =>
        o.status !== 'completed' ||
        !o.hideAfterAt ||
        new Date(o.hideAfterAt).getTime() > Date.now(),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingCount = items.filter(
    (c) => !c.analysisId || c.analysisStatus === 'failed',
  ).length;
  const analyzeVisible = async (): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    let submitted = 0;
    let skipped = 0;
    const failures: string[] = [];
    try {
      for (let start = 0; start < items.length; start += 20) {
        const chunk = items.slice(start, start + 20);
        try {
          const result = await api.analyzeCampaignBatch(productId, {
            campaigns: chunk.map((c) => ({ key: c.key, revision: c.revision })),
          });
          submitted += result.submitted;
          skipped += result.skipped;
          failures.push(
            ...result.failed.map(
              (f) =>
                `${chunk.find((c) => c.key === f.key)?.snapshot.campaignName || f.key}：${f.message}`,
            ),
          );
        } catch (e: unknown) {
          failures.push(
            `本批 ${chunk.length} 个系列提交未确认：${errorText(e)}；可重试，服务端会去重`,
          );
          break;
        }
      }
      await load();
      await onChanged();
      setNotice(
        `本次提交 ${submitted} 个系列，跳过 ${skipped} 个已分析/排队系列。每批最多 20 个系列交给现有 Codex 自动任务处理；提交不等于分析已完成。`,
      );
      if (failures.length) setError(failures.join('；'));
    } catch (e: unknown) {
      setError(`已提交 ${submitted} 个系列；刷新失败：${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const openDecision = (
    card: CampaignDecisionCard,
    type: DecideCampaignRequest['decision'],
  ): void => {
    setDecision({ card, type });
    setReason('');
    setBudget('');
  };
  const budgetAction: boolean = Boolean(
    decision &&
    ['increase_budget', 'decrease_budget'].includes(
      decision.card.primaryAction.actionType,
    ),
  );

  return (
    <section className="mb-6 space-y-4" data-ai-section-type="card-list">
      <CampaignBoardList
        board={board}
        busy={busy}
        pendingCount={pendingCount}
        analyzeVisible={analyzeVisible}
        setRulesOpen={setRulesOpen}
        setPolicy={setPolicy}
        load={load}
        error={error}
        notice={notice}
        filter={filter}
        setFilter={setFilter}
        search={search}
        setSearch={setSearch}
        items={items}
        setDetail={setDetail}
        openDecision={openDecision}
      />
      <CampaignBoardOrders
        orders={orders}
        busy={busy}
        setExecution={setExecution}
        setReason={setReason}
        run={run}
        setHistoryOrder={setHistoryOrder}
      />
      <CampaignBoardDetail
        detail={detail}
        setDetail={setDetail}
        selected={selected}
        busy={busy}
        run={run}
        productId={productId}
        error={error}
      />
      <Dialog
        open={Boolean(decision)}
        onOpenChange={(open) => !open && setDecision(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision?.type === 'accept'
                ? '生成待执行单'
                : decision?.type === 'reject'
                  ? '记录不接受原因'
                  : '加入观察'}
            </DialogTitle>
            <DialogDescription>
              {decision?.card.snapshot.campaignName}
            </DialogDescription>
          </DialogHeader>
          {decision?.type === 'accept' && budgetAction && (
            <div className="space-y-2">
              <p className="text-sm">
                此建议仅适用于系列日预算。请在 Facebook
                确认预算由系列控制，且本页国家覆盖该系列全部投放后，填写实际当前预算。若还有其他国家，不要执行此整系列预算单。
              </p>
              <Input
                aria-label="实际系列日预算"
                type="number"
                min="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="实际日预算（美元），不能填写消耗"
              />
              {Number(budget) > 0 && (
                <p className="text-sm text-blue-700">
                  执行单：${Number(budget).toFixed(2)} → $
                  {(
                    Number(budget) *
                    (1 + (decision.card.primaryAction.changePct || 0) / 100)
                  ).toFixed(2)}
                  /天
                </p>
              )}
            </div>
          )}
          <Textarea
            aria-label="决策原因"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="填写接受、不接受或观察的原因"
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button
            disabled={
              busy ||
              !reason.trim() ||
              (decision?.type === 'accept' &&
                budgetAction &&
                !(Number(budget) > 0))
            }
            onClick={() =>
              decision &&
              void run(async () => {
                await api.decideCampaign(productId, {
                  key: decision.card.key,
                  revision: decision.card.revision,
                  decision: decision.type,
                  reason,
                  budgetLevel: budgetAction ? 'campaign' : undefined,
                  budgetTargetId: decision.card.snapshot.campaignId,
                  beforeBudget: budgetAction ? Number(budget) : undefined,
                });
                setDecision(null);
              }, '已记录决策；待执行单需要在实际投放操作完成后登记。')
            }
          >
            确认记录
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(execution)}
        onOpenChange={(open) => !open && setExecution(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记已实际执行</DialogTitle>
            <DialogDescription>
              确认你已在 Facebook
              完成该执行单的操作。系统会保存执行时间并启动观测。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {execution?.campaignName} ·{' '}
            {execution?.campaignExecution?.proposal.rationale}
          </p>
          <Textarea
            aria-label="实际执行记录"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="记录实际改动；若与执行单不同，请写明"
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button
            disabled={busy || !reason.trim()}
            onClick={() =>
              execution &&
              void run(async () => {
                await api.executeCampaign(execution.id, reason);
                setExecution(null);
              }, '实际执行已登记，已进入实验库和每小时复查。')
            }
          >
            确认已执行
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(policy)}
        onOpenChange={(open) => !open && setPolicy(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>产品决策策略</DialogTitle>
            <DialogDescription>
              当前为试运行参数，请按产品实际规模调整。达标线继续使用指标库；预算方向与幅度由这些参数约束。
            </DialogDescription>
          </DialogHeader>
          {policy &&
            (
              Object.keys(POLICY_LABELS) as Array<keyof CampaignDecisionPolicy>
            ).map((key) => (
              <label key={key} className="space-y-1 text-sm">
                {POLICY_LABELS[key]}
                <Input
                  type="number"
                  value={policy[key]}
                  onChange={(e) =>
                    setPolicy({ ...policy, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button
            disabled={busy}
            onClick={() =>
              policy &&
              void run(async () => {
                await api.saveCampaignPolicy(productId, policy);
                setPolicy(null);
              }, '产品策略已保存，系列判断已重新计算。')
            }
          >
            保存策略
          </Button>
        </DialogContent>
      </Dialog>
      <CampaignRulesPanel
        productId={productId}
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        onSaved={async (nextBoard) => {
          ++loadSequence.current;
          setBoard(nextBoard);
          setError('');
          await onChanged();
        }}
      />
      <CampaignExecutionHistory
        order={historyOrder}
        onClose={() => setHistoryOrder(null)}
        onChanged={async () => {
          await load();
          await onChanged();
        }}
      />
    </section>
  );
};
