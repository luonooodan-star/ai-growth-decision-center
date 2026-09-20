import React from 'react';
import type { GrowthDecisionCase } from '@shared/api.interface';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { updateDecision } from '@/api/growth-decision';
interface Props {
  orders: GrowthDecisionCase[];
  busy: boolean;
  setExecution: (order: GrowthDecisionCase) => void;
  setReason: (reason: string) => void;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
  setHistoryOrder: (order: GrowthDecisionCase) => void;
}
export const CampaignBoardOrders: React.FC<Props> = ({
  orders,
  busy,
  setExecution,
  setReason,
  run,
  setHistoryOrder,
}) => (
  <Card className="shadow-none">
    <CardHeader>
      <CardTitle>执行与复查</CardTitle>
      <CardDescription>
        接受后先登记实际执行。历史指标仍按原数据日保存，执行结果从实际执行时间跟踪。
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="max-h-80 space-y-3 overflow-y-auto">
        {!orders.length && (
          <p className="text-sm text-slate-500">
            暂无执行单。选择一个系列的建议后，会在这里跟踪。
          </p>
        )}
        {orders.map((order) => (
          <div key={order.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-words text-sm font-semibold">
                {order.campaignName}
              </p>
              <Badge variant="outline">
                {order.status !== 'completed' &&
                order.campaignExecution?.reviewDueAt &&
                Date.parse(order.campaignExecution.reviewDueAt) <= Date.now()
                  ? '已到期，请复查'
                  : order.status === 'completed'
                    ? '已结束'
                    : order.campaignExecution?.state === 'pending'
                      ? '待执行'
                      : order.campaignExecution?.state === 'executed'
                        ? '已执行／复查中'
                        : order.campaignExecution?.state === 'rejected'
                          ? '未接受'
                          : '观察中'}
              </Badge>
            </div>
            <p className="mt-2 text-sm">
              {order.campaignExecution?.proposal.rationale}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              账户 {order.adAccountId || '未定位'} ·{' '}
              {order.campaignExecution?.proposal.targetLevel}{' '}
              {order.campaignExecution?.proposal.targetName ||
                order.campaignExecution?.proposal.targetId}
            </p>
            {order.recoveryReadyAt && order.status !== 'completed' && (
              <p className="mt-2 text-sm text-emerald-700">
                指标已持续恢复，待人工核对后结束；不自动认定措施有效。
              </p>
            )}
            {order.campaignExecution?.beforeBudget !== undefined && (
              <p className="mt-1 text-sm font-medium text-blue-700">
                日预算 ${order.campaignExecution.beforeBudget} → $
                {order.campaignExecution.afterBudget}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {order.campaignExecution?.reviewDueAt
                ? `复查时间 ${new Date(order.campaignExecution.reviewDueAt).toLocaleString('zh-CN')}`
                : `创建 ${new Date(order.createdAt).toLocaleString('zh-CN')}`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {order.campaignExecution?.state === 'pending' && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setExecution(order);
                    setReason('');
                  }}
                >
                  登记已执行
                </Button>
              )}
              {order.campaignExecution?.state === 'pending' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        updateDecision(order.id, {
                          action: 'rejected',
                          reason: '人工撤回尚未执行的系列执行单',
                        }),
                      '执行单已撤回，记录保留',
                    )
                  }
                >
                  撤回未执行单
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setHistoryOrder(order)}
              >
                执行前后与历史
              </Button>
            </div>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
);
