import { lazy, Suspense, useEffect } from 'react';
import { LoadingState } from './components/QueryState';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);
const IssuesPage = lazy(() =>
  import('./pages/IssuesPage').then((module) => ({ default: module.IssuesPage })),
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const ProductsPage = lazy(() =>
  import('./pages/ProductsPage').then((module) => ({ default: module.ProductsPage })),
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })),
);
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then((module) => ({ default: module.RegisterPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })),
);
const ReviewsPage = lazy(() =>
  import('./pages/ReviewsPage').then((module) => ({ default: module.ReviewsPage })),
);
const UploadPage = lazy(() =>
  import('./pages/UploadPage').then((module) => ({ default: module.UploadPage })),
);
import { useThemeStore } from './store/theme.store';
import { useAuthStore } from './store/auth.store';

export function App() {
  const { isDark } = useThemeStore();
  const initialized = useAuthStore((state) => state.initialized);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  if (!initialized)
    return (
      <div role="status" className="p-8 text-center">
        Восстановление сессии…
      </div>
    );

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="p-6">
            <LoadingState>Загрузка страницы…</LoadingState>
          </div>
        }
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/parsing" element={<Navigate to="/upload?source=parsing" replace />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
