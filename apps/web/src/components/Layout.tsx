import { useState } from 'react';
import { Menu, Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../store/theme.store';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 flex md:hidden transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onNavigate={() => setMobileOpen(false)} />
      </div>

      <main className="flex-1 overflow-auto">
        {/* Mobile header */}
        <div className="flex items-center gap-3 px-4 py-3 md:hidden border-b border-neutral-200 dark:border-neutral-800">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
          >
            <Menu className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />
          </button>
          <span className="text-sm font-bold text-neutral-700 dark:text-neutral-200 flex-1">Hidden Issues</span>
          <ThemeToggle />
        </div>

        <div className="mx-auto max-w-7xl px-4 md:px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function ThemeToggle() {
  const { isDark, toggle } = useThemeStore();
  return (
    <button
      onClick={toggle}
      className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
      title={isDark ? 'Светлая тема' : 'Тёмная тема'}
    >
      {isDark
        ? <Sun className="h-4 w-4 text-amber-400" />
        : <Moon className="h-4 w-4 text-neutral-500" />}
    </button>
  );
}
