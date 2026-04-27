import { FileText, MessageSquare, Moon, Sun, Upload, User as UserIcon } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { useThemeStore } from '../store/theme.store';
import { useProfileStats, useStats } from '../lib/queries';

export function ProfilePage() {
  const { user } = useAuthStore();
  const profileStats = useProfileStats();
  const overallStats = useStats();
  const { isDark, toggle } = useThemeStore();

  return (
    <div className="space-y-6">
      <div>
        <h1>Профиль</h1>
        <p className="text-sm text-primary-600 dark:text-primary-400 mt-1">
          Информация об аккаунте и активности
        </p>
      </div>

      <div className="card flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shadow-card">
          <UserIcon className="h-8 w-8 text-white" />
        </div>
        <div>
          <div className="text-lg font-bold text-primary-900 dark:text-primary-100">
            {user?.name || 'Без имени'}
          </div>
          <div className="text-sm text-primary-600 dark:text-primary-400">{user?.email}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          hero
          icon={MessageSquare}
          label="Отзывов в системе"
          value={overallStats.data?.total.toString() ?? '—'}
        />
        <StatCard
          icon={Upload}
          label="Моих загрузок"
          value={profileStats.data?.uploads.toString() ?? '—'}
        />
        <StatCard
          icon={FileText}
          label="Моих отчётов"
          value={profileStats.data?.reports.toString() ?? '—'}
        />
      </div>

      <div className="card">
        <h3 className="mb-4">Настройки</h3>
        <div className="flex items-center justify-between py-2">
          <div>
            <div className="font-semibold text-primary-900 dark:text-primary-100">Тёмная тема</div>
            <div className="text-xs text-primary-600 dark:text-primary-400 mt-0.5">
              Переключить цветовую схему интерфейса
            </div>
          </div>
          <button
            onClick={toggle}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
              isDark ? 'bg-primary-600' : 'bg-primary-200'
            }`}
            aria-label="Переключить тему"
          >
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-card transition-transform duration-300 ${
                isDark ? 'translate-x-7' : 'translate-x-1'
              }`}
            >
              {isDark ? (
                <Moon className="h-3.5 w-3.5 text-primary-700" />
              ) : (
                <Sun className="h-3.5 w-3.5 text-primary-500" />
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hero = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hero?: boolean;
}) {
  return (
    <div className={hero ? 'card-hero' : 'card'}>
      <div className="flex items-center gap-3">
        <div
          className={`h-10 w-10 rounded-xl flex items-center justify-center ${
            hero ? 'bg-white/20 text-white' : 'bg-primary-300 text-primary-900'
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className={`text-xs ${hero ? 'text-primary-300' : 'text-primary-600 dark:text-primary-400'}`}>
            {label}
          </div>
          <div className={`text-2xl font-bold ${hero ? 'text-white' : 'text-primary-900 dark:text-primary-100'}`}>
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}
