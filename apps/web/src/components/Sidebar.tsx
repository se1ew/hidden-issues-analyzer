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
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-100 bg-white">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-neutral-100">
        <div className="h-9 w-9 rounded-lg bg-primary-300 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-neutral-700" />
        </div>
        <div>
          <div className="text-sm font-semibold text-neutral-700">Hidden Issues</div>
          <div className="text-xs text-neutral-400">Analyzer</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-primary-100 text-neutral-700'
                  : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-neutral-100 px-3 py-3">
        {user && (
          <div className="px-3 py-2 text-xs">
            <div className="font-medium text-neutral-700 truncate">{user.name || user.email}</div>
            <div className="text-neutral-400 truncate">{user.email}</div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
        >
          <LogOut className="h-4 w-4" />
          Выйти
        </button>
      </div>
    </aside>
  );
}
