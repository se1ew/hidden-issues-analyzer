import {
  FileText,
  MessageSquare,
  Moon,
  Sun,
  Upload,
  User,
  Cpu,
  Palette,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { useThemeStore } from '../store/theme.store';
import { useProfileStats, useStats } from '../lib/queries';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logoutSession, apiErrorMessage } from '../lib/api';
import { ErrorState, LoadingState } from '../components/QueryState';
import { PageHeader, MetricCard } from '../components/ui';
import { LlmStatus } from '../components/LlmStatus';
import { SystemStatus } from '../components/SystemStatus';

export function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const profile = useProfileStats(),
    overall = useStats();
  const { isDark, toggle } = useThemeStore();
  const [loggingOut, setLoggingOut] = useState(false),
    [logoutError, setLogoutError] = useState('');
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Настройки"
        description="Аккаунт, модели анализа и параметры рабочего пространства"
      />
      <div className="settings-layout">
        <nav aria-label="Разделы настроек" className="settings-nav xl:sticky xl:top-24 self-start">
          <a href="#account" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Аккаунт
          </a>
          <a href="#models" className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            AI-модели
          </a>
          <a href="#appearance" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Внешний вид
          </a>
          <a href="#diagnostics" className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Диагностика
          </a>
          <a href="#security" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Сессия
          </a>
        </nav>
        <div className="space-y-6 min-w-0">
          <section id="account" className="card space-y-5">
            <h2 className="text-base">Информация об аккаунте</h2>
            <div className="flex gap-4 items-center">
              <div className="h-14 w-14 shrink-0 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xl font-semibold">
                {(user?.name || user?.email || 'П').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold break-words">{user?.name || 'Без имени'}</p>
                <p className="text-sm text-neutral-500 mt-1 break-all">{user?.email}</p>
              </div>
            </div>
          </section>
          {profile.isError || overall.isError ? (
            <ErrorState
              error={profile.error ?? overall.error}
              retry={() => Promise.all([profile.refetch(), overall.refetch()])}
            />
          ) : profile.isPending || overall.isPending ? (
            <LoadingState>Загрузка активности…</LoadingState>
          ) : (
            <div className="grid sm:grid-cols-3 gap-3">
              <MetricCard
                icon={MessageSquare}
                label="Моих отзывов"
                value={overall.data?.total.toLocaleString('ru-RU')}
              />
              <MetricCard icon={Upload} label="Загрузок" value={profile.data?.uploads} />
              <MetricCard icon={FileText} label="Отчётов" value={profile.data?.reports} />
            </div>
          )}
          <section id="models" className="space-y-3">
            <LlmStatus editable />
          </section>
          <section id="appearance" className="card">
            <h2 className="text-base">Внешний вид</h2>
            <p className="text-xs text-neutral-500 mt-1 mb-4">
              Выбранная тема сохраняется в этом браузере.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { dark: false, label: 'Светлая тема', Icon: Sun },
                { dark: true, label: 'Тёмная тема', Icon: Moon },
              ].map(({ dark, label, Icon }) => (
                <button
                  key={label}
                  className={
                    'flex items-center gap-3 rounded-lg border p-4 text-left text-sm ' +
                    (isDark === dark
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-neutral-200')
                  }
                  aria-pressed={isDark === dark}
                  onClick={() => {
                    if (isDark !== dark) toggle();
                  }}
                >
                  <Icon className="h-5 w-5" />
                  <span className="flex-1">{label}</span>
                  <span
                    className={
                      'h-3 w-3 rounded-full border ' +
                      (isDark === dark ? 'bg-primary-600 border-primary-600' : 'border-neutral-300')
                    }
                  />
                </button>
              ))}
            </div>
          </section>
          <section id="diagnostics">
            <SystemStatus showModel={false} />
          </section>
          <section id="security" className="card space-y-3">
            <h2 className="text-base">Текущая сессия</h2>
            <p className="text-sm text-neutral-500">
              Выход отзывает сессию на сервере. Для продолжения потребуется повторный вход.
            </p>
            {logoutError && (
              <p role="alert" className="text-sm text-red-600">
                {logoutError}
              </p>
            )}
            <button
              className="btn-outline"
              disabled={loggingOut}
              onClick={async () => {
                setLoggingOut(true);
                setLogoutError('');
                try {
                  await logoutSession();
                  navigate('/login', { replace: true });
                } catch (error) {
                  setLogoutError(apiErrorMessage(error));
                } finally {
                  setLoggingOut(false);
                }
              }}
            >
              {loggingOut ? 'Завершение сессии…' : 'Выйти из аккаунта'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
