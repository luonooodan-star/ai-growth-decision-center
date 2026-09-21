import {
  Activity,
  Database,
  FlaskConical,
  Gauge,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

const Layout = () => {
  const navClass = ({ isActive }: { isActive: boolean }): string =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
      isActive ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
    }`;

  return (
    <div className="min-h-screen bg-slate-50 text-foreground">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1540px] flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-950">
                AI 增长决策中心
              </p>
              <p className="text-xs text-slate-500">
                Growth decision workspace
              </p>
            </div>
          </div>
          <nav className="order-last flex w-full items-center gap-1 overflow-x-auto whitespace-nowrap rounded-xl bg-slate-100 p-1 md:order-none md:w-auto">
            <NavLink to="/data" className={navClass}>
              <Database className="size-3.5" />
              投放数据
            </NavLink>
            <NavLink to="/" className={navClass} end>
              <Activity className="size-3.5" />
              产品中心
            </NavLink>
            <NavLink to="/adjustments" className={navClass}>
              <SlidersHorizontal className="size-3.5" />
              广告调整
            </NavLink>
            <NavLink to="/operations" className={navClass}>
              <Activity className="size-3.5" />
              操作复盘
            </NavLink>
            <NavLink to="/metrics" className={navClass}>
              <Gauge className="size-3.5" />
              指标库
            </NavLink>
            <NavLink to="/skills" className={navClass}>
              <FlaskConical className="size-3.5" />
              Skill 迭代
            </NavLink>
          </nav>
          <div className="text-right">
            <p className="text-xs font-medium text-slate-800">当前用户</p>
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
