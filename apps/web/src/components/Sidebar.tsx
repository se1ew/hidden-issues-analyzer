import {
  AlertTriangle,
  BarChart3,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  ScanLine,
  Package,
  Upload,
  User,
} from 'lucide-react';
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import clsx from 'clsx';
import { logoutSession } from '../lib/api';
import toast from 'react-hot-toast';
import { useProductStore } from '../store/product.store';
import { useProducts } from '../lib/queries';

const navGroups = [
  [
    { to: '/dashboard', label: 'Обзор', icon: LayoutDashboard },
    { to: '/issues', label: 'Скрытые проблемы', icon: AlertTriangle },
    { to: '/reviews', label: 'Все отзывы', icon: MessageSquare },
    { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
  ],
  [
    { to: '/products', label: 'Товары', icon: Package },
    { to: '/upload', label: 'Импорт отзывов', icon: Upload },
    { to: '/reports', label: 'Отчёты', icon: FileText },
  ],
  [{ to: '/profile', label: 'Настройки', icon: User }],
];

function SidebarRoot({ children }: { children: React.ReactNode }) {
  return (
    <aside className="sidebar flex max-w-[85vw] h-full shrink-0 flex-col overflow-y-auto">
      {children}
    </aside>
  );
}

function SidebarSection({
  children,
  border,
}: {
  children: React.ReactNode;
  border: 'top' | 'bottom';
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-5 py-4',
        border === 'bottom' ? 'sidebar-border-bottom' : 'sidebar-border-top flex-col items-start',
      )}
    >
      {children}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [loggingOut, setLoggingOut] = React.useState(false);

  const { selectedProductId, selectedRunId } = useProductStore();
  const products = useProducts();
  const product = products.data?.items.find((item) => item.id === selectedProductId);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutSession();
      navigate('/login');
    } catch {
      toast.error('Не удалось завершить сессию. Повторите выход.');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <SidebarRoot>
      {/* Logo */}
      <SidebarSection border="bottom">
        <div className="brand-mark">
          <ScanLine className="h-5 w-5" />
        </div>
        <div>
          <div className="text-lg font-bold tracking-tight sidebar-title">ReviewLens</div>
          <div className="text-xs sidebar-subtitle">Аналитика отзывов</div>
        </div>
      </SidebarSection>

      <div className="sidebar-context mt-5 sidebar-subtitle break-words">
        <span className="block font-medium line-clamp-3" title={product?.name}>
          {product?.name ?? 'Все товары'}
        </span>
        <span>{selectedRunId ? 'Выбран сохранённый запуск' : 'Все загруженные отзывы'}</span>
      </div>
      <nav aria-label="Основная навигация" className="flex-1 px-3 py-5 space-y-5">
        {navGroups.map((group, gi) => (
          <div key={gi} className={clsx('space-y-1')}>
            <p className="sidebar-section-label mb-2">
              {['Аналитика', 'Управление', 'Аккаунт'][gi]}
            </p>
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
            disabled={loggingOut}
            className="flex flex-1 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200 sidebar-nav-item sidebar-nav-inactive"
          >
            <LogOut className="h-4 w-4" />
            Выйти
          </button>
        </div>
      </SidebarSection>
    </SidebarRoot>
  );
}
