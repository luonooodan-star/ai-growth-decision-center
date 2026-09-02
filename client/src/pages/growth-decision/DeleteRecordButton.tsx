import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { growthDecision } from '@/api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type DeleteMode = 'record' | 'skill_candidate';

interface DeleteRecordButtonProps {
  id: string;
  label: string;
  mode?: DeleteMode;
  onDeleted: () => void | Promise<void>;
}

const DeleteRecordButton: React.FC<DeleteRecordButtonProps> = ({
  id,
  label,
  mode = 'record',
  onDeleted,
}) => {
  const [open, setOpen] = useState<boolean>(false);
  const [reason, setReason] = useState<string>('');
  const [confirmation, setConfirmation] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const confirmationText: string = mode === 'record' ? '删除' : '删除候选';
  const ready: boolean =
    reason.trim().length >= 2 && confirmation === confirmationText;

  const submit = async (
    event: React.MouseEvent<HTMLButtonElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError('');
    try {
      if (mode === 'record') {
        await growthDecision.deleteRecord(id, {
          confirmation: 'DELETE_RECORD',
          reason: reason.trim(),
        });
      } else {
        await growthDecision.deleteSkillRuleCandidate(id, {
          confirmation: 'DELETE_SKILL_CANDIDATE',
          reason: reason.trim(),
        });
      }
      setOpen(false);
      setReason('');
      setConfirmation('');
      await onDeleted();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : '删除失败',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-red-600">
          <Trash2 className="size-4" /> 删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除“{label}”？</AlertDialogTitle>
          <AlertDialogDescription>
            删除后将从业务页面隐藏，但原始记录、删除人、删除时间和原因会保留在审计档案中。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <Input
            value={reason}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setReason(event.target.value)
            }
            placeholder="填写删除原因（必填）"
          />
          <Input
            value={confirmation}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setConfirmation(event.target.value)
            }
            placeholder={`二次确认：输入“${confirmationText}”`}
          />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ready || saving}
            className="bg-red-600 hover:bg-red-700"
            onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
              void submit(event)
            }
          >
            {saving ? '删除中…' : '确认删除并留档'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export { DeleteRecordButton };
