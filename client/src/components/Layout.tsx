import { useAppInfo } from '@lark-apaas/client-toolkit/hooks/useAppInfo';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';
import { Activity, Database, FlaskConical, Sparkles } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';

const Layout = () => {
  const appInfo = useAppInfo();
  const userInfo = useCurrentUserProfile();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 text-foreground">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1540px] items-center justify-between gap-6 px-5 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-950">
                {appInfo.appName || 'AI 增长决策中心'}
              </p>
              <p className="text-xs text-slate-500">Growth decision workspace</p>
            </div>
          </div>
          <nav className="hidden items-center gap-1 rounded-xl bg-slate-100 p-1 md:flex">
            <Link
              to="/"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${location.pathname === '/' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
            >
              <Activity className="size-3.5" />产品中心
            </Link>
            <span className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
              <Database className="size-3.5" />实验库
            </span>
            <span className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
              <FlaskConical className="size-3.5" />Skill 迭代
            </span>
          </nav>
          <div className="text-right">
            <p className="text-xs font-medium text-slate-800">
              {userInfo?.name || '当前用户'}
            </p>
            <p className="text-[11px] text-slate-500">人工决策负责人</p>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
