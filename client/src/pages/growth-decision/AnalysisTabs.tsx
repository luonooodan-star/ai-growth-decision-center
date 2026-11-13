import { NavLink } from 'react-router-dom';
export default function AnalysisTabs() {
  return (
    <nav className="mb-6 flex gap-2">
      <NavLink
        end
        to="/analysis"
        className={({ isActive }) =>
          `rounded-lg px-4 py-2 text-sm ${isActive ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`
        }
      >
        素材标签分析
      </NavLink>
      <NavLink
        to="/analysis/behavior"
        className={({ isActive }) =>
          `rounded-lg px-4 py-2 text-sm ${isActive ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`
        }
      >
        优化师 / 渠道行为漏斗
      </NavLink>
    </nav>
  );
}
