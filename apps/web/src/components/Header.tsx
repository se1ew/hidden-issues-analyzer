import { Menu, Moon, Sun, ChevronRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useThemeStore } from '../store/theme.store';
import { useAuthStore } from '../store/auth.store';

const titles: Record<string, string> = {
  '/dashboard': 'Обзор',
  '/products': 'Товары',
  '/upload': 'Импорт отзывов',
  '/reviews': 'Все отзывы',
  '/issues': 'Скрытые проблемы',
  '/analytics': 'Аналитика',
  '/reports': 'Отчёты',
  '/profile': 'Настройки',
};
export function Header({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const { isDark, toggle } = useThemeStore();
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  return (
    <header className="app-header">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenu}
          aria-label="Открыть навигацию"
          aria-expanded={menuOpen}
          className="btn-ghost !px-2 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="hidden sm:inline text-xs text-neutral-500">Рабочее пространство</span>
        <ChevronRight className="hidden sm:block h-3.5 w-3.5 text-neutral-400" />
        <span className="text-sm font-medium truncate">
          {titles[location.pathname] ?? 'ReviewLens'}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          className="btn-ghost !px-2"
          onClick={toggle}
          aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
          title={isDark ? 'Светлая тема' : 'Тёмная тема'}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <Link
          to="/profile"
          aria-label="Настройки аккаунта"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-semibold"
        >
          {(user?.name || user?.email || 'П').slice(0, 1).toUpperCase()}
        </Link>
      </div>
    </header>
  );
}
