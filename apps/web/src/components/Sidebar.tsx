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
    <aside className="flex w-64 shrink-0 flex-col bg-white border-r" style={{ borderColor: '#E0ECF8' }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b" style={{ borderColor: '#E8F0FA' }}>
        <div className="h-9 w-9 rounded-xl flex items-center justify-center shadow-sm" style={{ background: '#1E3248' }}>
          <AlertTriangle className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-bold tracking-wide" style={{ color: '#1A2D40' }}>Hidden Issues</div>
          <div className="text-xs" style={{ color: '#7A96B0' }}>Analyzer</div>
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
                  ? 'text-primary-900 font-semibold'
                  : 'hover:bg-primary-50',
              )
            }
            style={({ isActive }) => isActive
              ? { background: '#D8EEFF', color: '#1A2D40' }
              : { color: '#4A6070' }
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t px-3 py-3" style={{ borderColor: '#E8F0FA' }}>
        {user && (
          <div className="px-3 py-2 text-xs mb-1">
            <div className="font-semibold truncate" style={{ color: '#1A2D40' }}>{user.name || user.email}</div>
            <div className="truncate mt-0.5" style={{ color: '#7A96B0' }}>{user.email}</div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200 hover:bg-primary-50"
          style={{ color: '#4A6070' }}
        >
          <LogOut className="h-4 w-4" />
          Выйти
        </button>
      </div>
    </aside>
  );
}
