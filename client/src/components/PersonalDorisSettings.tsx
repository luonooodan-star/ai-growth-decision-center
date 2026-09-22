import { useEffect, useState } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function PersonalDorisSettings({ username }: { username: string }) {
  const [open, setOpen] = useState(false),
    [configured, setConfigured] = useState(false);
  const [key, setKey] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<'save' | 'revoke' | null>(
    null,
  );
  useEffect(() => {
    if (username)
      axios
        .get('/api/center/doris')
        .then(({ data }) => setConfigured(data.configured))
        .catch(() => setError('授权状态读取失败'));
  }, [username]);
  const save = async (revoke = false) => {
    setBusy(true);
    setError('');
    try {
      await axios.post(
        '/api/center/doris',
        revoke ? { revoke: true } : { key },
      );
      setKey('');
      window.location.reload();
    } catch {
      setError('保存失败，请检查 Key 格式、登录状态和服务配置');
    } finally {
      setBusy(false);
      setConfirmation(null);
    }
  };
  return (
    <>
      <button
        className={`block text-xs ${configured ? 'text-slate-500' : 'text-amber-700'}`}
        disabled={!username}
        onClick={() => setOpen(true)}
      >
        {configured ? '我的 Doris 授权' : '配置我的 Doris Key'}
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            setKey('');
            setConfirmation(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{username} · 个人 Doris 授权</DialogTitle>
            <DialogDescription>
              只用于本人的数据查询，不与其他用户共用。服务端加密保存，页面不回显
              Key。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            {configured
              ? '已保存个人凭据；实际数据范围由 Doris 服务端权限决定。'
              : '尚未配置，无法读取业务数据；不会使用管理员凭据。'}{' '}
            新账号保存后，请在投放数据页查询并同步产品。
          </p>
          <p className="text-xs text-amber-700">
            请使用本人获授权的 Key，而非管理员全量 Key。Key
            权限不等于页面筛选；如返回了他人的数据，请让数据管理员收紧源端权限。请通过受信
            HTTPS 或受控内网配置。
          </p>
          <Input
            type="password"
            autoComplete="new-password"
            aria-label="个人 Doris Key"
            placeholder="输入本人的 Doris Key"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setConfirmation(null);
            }}
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              disabled={busy || !key.trim()}
              onClick={() => setConfirmation('save')}
            >
              保存个人授权
            </Button>
            {configured && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmation('revoke')}
              >
                撤销本人授权
              </Button>
            )}
          </div>
          {confirmation && (
            <div
              className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
              role="alert"
            >
              <p className="text-sm text-amber-900">
                {confirmation === 'revoke'
                  ? '确认撤销本人的 Doris Key？旧权限缓存将不再展示。'
                  : '确认保存本人的 Doris Key？将使用独立数据空间，需要重新查询并同步产品。'}
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => save(confirmation === 'revoke')}
                >
                  确认{confirmation === 'revoke' ? '撤销' : '保存'}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmation(null)}
                >
                  取消
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
