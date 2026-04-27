import {
  AlertTriangle,
  BarChart3,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Moon,
  Package,
  Sun,
  Upload,
  User,
} from 'lucide-react';
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { useThemeStore } from '../store/theme.store';
import clsx from 'clsx';

const navGroups = [
  [
    { to: '/dashboard', label: 'Обзор', icon: LayoutDashboard },
    { to: '/issues', label: 'Проблемы', icon: AlertTriangle },
    { to: '/reviews', label: 'Отзывы', icon: MessageSquare },
    { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
  ],
  [
    { to: '/products', label: 'Товары', icon: Package },
    { to: '/upload', label: 'Загрузка', icon: Upload },
    { to: '/reports', label: 'Отчёты', icon: FileText },
  ],
  [
    { to: '/profile', label: 'Профиль', icon: User },
  ],
];

function SidebarRoot({ children }: { children: React.ReactNode }) {
  return (
    <aside className="sidebar flex w-64 shrink-0 flex-col">
      {children}
    </aside>
  );
}

function SidebarSection({ children, border }: { children: React.ReactNode; border: 'top' | 'bottom' }) {
  return (
    <div className={clsx(
      'flex items-center gap-3 px-5 py-4',
      border === 'bottom' ? 'sidebar-border-bottom' : 'sidebar-border-top flex-col items-start',
    )}>
      {children}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const navigate = useNavigate();
  const { user, clear } = useAuthStore();
  const { isDark, toggle: toggleTheme } = useThemeStore();

  const handleLogout = () => {
    clear();
    navigate('/login');
  };

  return (
    <SidebarRoot>
      {/* Logo */}
      <SidebarSection border="bottom">
        <div className="h-9 w-9 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0" style={{ background: '#1E3248' }}>
          <AlertTriangle className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-bold tracking-wide sidebar-title">Hidden Issues</div>
          <div className="text-xs sidebar-subtitle">Analyzer</div>
        </div>
      </SidebarSection>

      <nav className="flex-1 px-3 py-4 space-y-4">
        {navGroups.map((group, gi) => (
          <div key={gi} className={clsx('space-y-0.5', gi > 0 && 'border-t border-white/10 pt-3')}>
            {group.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 sidebar-nav-item',
                    isActive ? 'sidebar-nav-active' : 'sidebar-nav-inactive',
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <SidebarSection border="top">
        {user && (
          <div className="px-3 py-2 text-xs mb-1 w-full">
            <div className="font-semibold truncate sidebar-title">{user.name || user.email}</div>
            <div className="truncate mt-0.5 sidebar-subtitle">{user.email}</div>
          </div>
        )}
        <div className="flex items-center gap-2 w-full">
          <button
            onClick={handleLogout}
            className="flex flex-1 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200 sidebar-nav-item sidebar-nav-inactive"
          >
            <LogOut className="h-4 w-4" />
            Выйти
          </button>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl transition-all duration-200 sidebar-nav-item sidebar-nav-inactive"
            title={isDark ? 'Светлая тема' : 'Тёмная тема'}
          >
            {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </SidebarSection>
    </SidebarRoot>
  );
}
