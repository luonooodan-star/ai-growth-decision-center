import { useState } from 'react';
import axios from 'axios';
import { Database, Link2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PersonalDorisSettings } from '@/components/PersonalDorisSettings';
import { useAuthorization } from '@/components/AuthorizationContext';

export default function AuthorizationPage() {
  const { username, dorisConfigured, meta, ownerId, checkedAt, refresh } =
    useAuthorization();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const openMeta = async () => {
    setOpening(true);
    setError('');
    try {
      const { data } = await axios.post(
        '/api/growth-decision/adjustments/authorization-link',
        {},
        { timeout: 15000 },
      );
      window.location.assign(data.url);
    } catch {
      setError('无法打开个人授权入口，请让管理员检查本机桥配置与原工具服务。');
      setOpening(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-blue-600">
            PERSONAL CONNECTIONS
          </p>
          <h1 className="mt-2 text-2xl font-bold">授权与连接</h1>
          <p className="mt-2 text-sm text-slate-500">
            当前决策中心用户：{username || '身份待确认'}。Doris 与 Meta
            分别授权，不与其他用户共用。
          </p>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={meta === 'checking'}
        >
          <RefreshCw className="mr-2 size-4" />
          重新检测
        </Button>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-5 rounded-2xl border bg-white p-6">
          <Database className="size-6 text-blue-600" />
          <h2 className="text-lg font-semibold">Doris 数据授权</h2>
          <p
            className={`text-sm ${dorisConfigured ? 'text-emerald-700' : 'text-amber-700'}`}
          >
            {dorisConfigured ? '已配置个人 Key' : '尚未配置个人 Key'}
          </p>
          <p className="text-sm leading-6 text-slate-600">
            配置自己的 Doris
            Key，用于投放数据、产品决策和复盘。请向数据管理员获取属于本人权限范围的
            Key；不同 Key 的可见范围由 Doris 源端权限决定。
          </p>
          <PersonalDorisSettings username={username} />
          <p className="text-xs leading-5 text-slate-500">
            已配置仅代表凭据已保存，不代表数据连接已验证。保存后前往投放数据页查询并同步产品；更新或撤销
            Key 会切换本人的数据缓存空间。
          </p>
        </section>
        <section className="space-y-5 rounded-2xl border bg-white p-6">
          <Link2 className="size-6 text-blue-600" />
          <h2 className="text-lg font-semibold">Meta 桥接授权</h2>
          <p
            className={`text-sm ${meta === 'authorized' ? 'text-emerald-700' : 'text-amber-700'}`}
          >
            {meta === 'authorized'
              ? '已授权 · Meta 身份读取成功'
              : meta === 'checking'
                ? '正在检测个人桥接'
                : meta === 'unauthorized'
                  ? '未授权或授权已失效'
                  : '暂时无法验证，请检查桥接服务'}
          </p>
          {ownerId && (
            <p className="text-xs text-slate-500">Meta 用户 ID：{ownerId}</p>
          )}
          <p className="text-sm leading-6 text-slate-600">
            打开个人授权页，先确认原广告工具登录的是你自己的 Facebook
            身份，再授权给当前决策中心用户。也可在该页面撤销本人授权。
          </p>
          <Button disabled={!username || opening} onClick={openMeta}>
            {opening ? '正在打开…' : '打开 Meta 授权 / 撤销页面'}
          </Button>
          <p className="text-xs leading-5 text-slate-500">
            授权后返回本页点击“重新检测”。检测只读取身份，不修改广告；已授权不代表拥有全部广告账户的操作权限。
          </p>
          {checkedAt && (
            <p className="text-xs text-slate-400">
              最近检测：{new Date(checkedAt).toLocaleString()}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
