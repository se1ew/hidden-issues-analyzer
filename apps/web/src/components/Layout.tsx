import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Modal } from './Modal';
import { DataScopePanel } from './DataScopePanel';
import { AnalysisRunSync } from './AnalysisRunSync';

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const scoped = ['/dashboard', '/reviews', '/issues', '/analytics'].includes(location.pathname);
  return <div className="flex h-dvh overflow-hidden">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:z-[70] focus:bg-white focus:p-4">Перейти к содержимому</a>
    <div className="hidden md:flex"><Sidebar /></div>
    {mobileOpen && <Modal title="Навигация" drawer onClose={() => setMobileOpen(false)}><Sidebar onNavigate={() => setMobileOpen(false)} /></Modal>}
    <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 overflow-auto">
      <header className="flex items-center gap-3 px-4 py-3 md:hidden border-b border-neutral-200 dark:border-neutral-700">
        <button onClick={() => setMobileOpen(true)} aria-label="Открыть навигацию" aria-expanded={mobileOpen} className="btn-outline"><Menu className="h-5 w-5" /></button>
        <span className="text-sm font-semibold">ReviewLens</span>
      </header>
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 min-w-0">
        <AnalysisRunSync />
        {scoped && <DataScopePanel key={location.pathname === '/reviews' ? 'reviews-scope' : 'scope'} />}
        <Outlet />
      </div>
    </main>
  </div>;
}
