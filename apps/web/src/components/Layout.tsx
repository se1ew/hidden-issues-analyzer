import { useState } from 'react';
import { Header } from './Header';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Modal } from './Modal';
import { DataScopePanel } from './DataScopePanel';
import { AnalysisRunSync } from './AnalysisRunSync';

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const scoped = ['/dashboard', '/reviews', '/issues', '/analytics', '/reports'].includes(
    location.pathname,
  );
  return (
    <div className="app-shell">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:z-[70] focus:bg-white focus:p-4"
      >
        Перейти к содержимому
      </a>
      <div className="hidden md:flex">
        <Sidebar />
      </div>
      {mobileOpen && (
        <Modal title="Навигация" drawer onClose={() => setMobileOpen(false)}>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </Modal>
      )}
      <main id="main-content" tabIndex={-1} className="app-main">
        <Header onMenu={() => setMobileOpen(true)} menuOpen={mobileOpen} />
        <div className="app-content">
          <AnalysisRunSync />
          {scoped && (
            <DataScopePanel key={location.pathname === '/reviews' ? 'reviews-scope' : 'scope'} />
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
