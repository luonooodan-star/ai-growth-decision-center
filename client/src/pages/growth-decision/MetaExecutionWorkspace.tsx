import { useEffect, useState } from 'react';
import { ExternalLink, ShieldCheck, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getMetaWorkspaceConfig } from '@/api/meta-workspace';
import type { MetaWorkspaceConfig } from '@shared/api.interface';
import {
  canEmbedMetaWorkspace,
  META_WORKSPACE_SECTIONS,
} from '@shared/meta-workspace';

/** Keep the original workspace mounted while collapsed: never interrupt an upload on data refresh. */
export function MetaExecutionWorkspace() {
  const [config, setConfig] = useState<MetaWorkspaceConfig | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    let live = true;
    void getMetaWorkspaceConfig()
      .then((value) => {
        if (live) setConfig(value);
      })
      .catch(() => {
        if (live) setError('无法读取广告操作服务配置，请刷新页面重试。');
      });
    return () => {
      live = false;
    };
  }, []);
  const origin = config?.workspaceOrigin;
  const compatible = Boolean(
    origin && canEmbedMetaWorkspace(window.location.origin, origin),
  );
  const secureEntry =
    config?.secureCenterOrigin &&
    origin &&
    canEmbedMetaWorkspace(config.secureCenterOrigin, origin)
      ? `${config.secureCenterOrigin}/adjustments`
      : null;
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white"
      aria-label="Meta 广告操作工作区"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Upload className="h-4 w-4 text-blue-600" />
            广告操作
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            沿用原素材、配置及发布任务；不会自动执行广告调整。
          </p>
        </div>
        <Button
          variant={open ? 'secondary' : 'outline'}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? '收起操作区（不中断任务）' : '展开广告操作'}
        </Button>
      </div>
      <div hidden={!open} className="border-t border-slate-100 p-4">
        {!config && !error && (
          <p className="text-sm text-slate-500">正在读取接入配置…</p>
        )}
        {(error || config?.error) && (
          <p
            role="alert"
            className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
          >
            {error || config?.error}
          </p>
        )}
        {origin && (
          <>
            <p className="mb-3 flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="h-4 w-4" />
              授权和 key
              只由原工具管理。首次使用请在原工具完成登录，再载入工作区。
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href={origin} target="_blank" rel="noopener noreferrer">
                  打开原工具 / 登录
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
              {compatible && !started && (
                <Button onClick={() => setStarted(true)}>
                  已登录，载入操作工作区
                </Button>
              )}
            </div>
            {!compatible && (
              <div className="space-y-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <p>
                  页内操作需要与原工具使用相同主机名的 HTTPS 页面，以保留原登录
                  Cookie。当前入口尚不满足条件，不会降低 Cookie 安全设置。
                </p>
                {secureEntry && (
                  <Button asChild variant="outline">
                    <a href={secureEntry}>进入安全广告调整页</a>
                  </Button>
                )}
              </div>
            )}
            {compatible && started && (
              <>
                <p className="mb-2 text-xs text-slate-500">
                  在下方原导航切换功能；数据刷新及收起操作区不会重载它。离开整个页面前，请等待素材上传完成。若授权页或工作区被浏览器拦截，请通过上方原工具入口操作。
                </p>
                <iframe
                  title="Meta 素材与广告发布工作区"
                  src={origin}
                  className="h-[850px] w-full rounded-lg border border-slate-200 bg-white"
                  referrerPolicy="no-referrer"
                />
              </>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
              {META_WORKSPACE_SECTIONS.map((section) => (
                <a
                  key={section.path}
                  href={`${origin}${section.path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-blue-600"
                >
                  {section.label} ↗
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
