import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { IssuesPage } from './pages/IssuesPage';
import { LoginPage } from './pages/LoginPage';
import { ParsingPage } from './pages/ParsingPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { ReportsPage } from './pages/ReportsPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { UploadPage } from './pages/UploadPage';
import { useThemeStore } from './store/theme.store';

export function App() {
  const { isDark } = useThemeStore();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  return (
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
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/issues" element={<IssuesPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/parsing" element={<ParsingPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="/" element={<Navigate to="/upload" replace />} />
      <Route path="*" element={<Navigate to="/upload" replace />} />
    </Routes>
  );
}
