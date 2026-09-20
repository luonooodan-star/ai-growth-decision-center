import React, { useState } from 'react';
import type { CampaignDecisionCard } from '@shared/api.interface';
import { observeCampaignBatch } from '@/api/campaign-decision';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export const BatchObserveButton: React.FC<{
  productId: string;
  cards: CampaignDecisionCard[];
  onChanged: () => Promise<void>;
}> = ({ productId, cards, onChanged }) => {
  const [targets, setTargets] = useState<CampaignDecisionCard[]>([]),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const candidates = cards
    .filter(
      (c) =>
        c.workQueue === 'observation' &&
        !c.urgent &&
        !c.recentOrders.some(
          (o) =>
            o.status !== 'completed' &&
            o.campaignExecution?.state === 'observing',
        ),
    )
    .slice(0, 20);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!candidates.length || busy}
        onClick={() => {
          setTargets(candidates);
          setError('');
          setReason('');
        }}
      >
        批量观察当前候选（{candidates.length}）
      </Button>
      <Dialog
        open={!!targets.length}
        onOpenChange={(v) => !v && !busy && setTargets([])}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认这些系列保持观察</DialogTitle>
            <DialogDescription>
              最多 20
              个低风险观察候选；不改变广告，不批量接受预算建议。每个系列记录原因和复查时间。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 overflow-y-auto text-sm">
            {targets.map((c) => (
              <p key={c.key}>{c.snapshot.campaignName}</p>
            ))}
          </div>
          <Textarea
            aria-label="批量观察原因"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button
            disabled={busy || !reason.trim()}
            onClick={() => {
              setBusy(true);
              void observeCampaignBatch(
                productId,
                targets.map((c) => ({ key: c.key, revision: c.revision })),
                reason,
              )
                .then(async (result) => {
                  await onChanged();
                  if (result.failed.length) {
                    setError(
                      `已完成 ${result.submitted} 个；${result.failed.map((f) => f.message).join('；')}`,
                    );
                  } else setTargets([]);
                })
                .catch((e) => setError(e.message || '批量观察失败'))
                .finally(() => setBusy(false));
            }}
          >
            确认记录观察
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
};
