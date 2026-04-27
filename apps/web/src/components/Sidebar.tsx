import {
  AlertTriangle,
  BarChart3,
  FileText,
  Globe,
  LogOut,
  MessageSquare,
  Upload,
  User,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import clsx from 'clsx';

const navItems = [
  { to: '/upload', label: 'Загрузка', icon: Upload },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
  { to: '/issues', label: 'Скрытые проблемы', icon: AlertTriangle },
  { to: '/reviews', label: 'Отзывы', icon: MessageSquare },
  { to: '/reports', label: 'Отчёты', icon: FileText },
  { to: '/parsing', label: 'Парсинг', icon: Globe },
  { to: '/profile', label: 'Профиль', icon: User },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { user, clear } = useAuthStore();

  const handleLogout = () => {
    clear();
    navigate('/login');
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col" style={{ background: 'linear-gradient(180deg, #0d3548 0%, #071521 100%)' }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-card">
          <AlertTriangle className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-bold text-white tracking-wide">Hidden Issues</div>
          <div className="text-xs text-primary-400">Analyzer</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-primary-400/20 text-primary-300 border border-primary-400/30 shadow-sm'
                  : 'text-primary-300/70 hover:bg-white/5 hover:text-white border border-transparent',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 px-3 py-3">
        {user && (
          <div className="px-3 py-2 text-xs mb-1">
            <div className="font-semibold text-white truncate">{user.name || user.email}</div>
            <div className="text-primary-400 truncate mt-0.5">{user.email}</div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-primary-400 hover:bg-white/5 hover:text-white transition-all duration-200"
        >
          <LogOut className="h-4 w-4" />
          Выйти
        </button>
      </div>
    </aside>
  );
}
