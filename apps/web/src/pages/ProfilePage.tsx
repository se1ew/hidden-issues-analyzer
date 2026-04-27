import { FileText, MessageSquare, Upload, User as UserIcon } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { useProfileStats, useStats } from '../lib/queries';

export function ProfilePage() {
  const { user } = useAuthStore();
  const profileStats = useProfileStats();
  const overallStats = useStats();

  return (
    <div className="space-y-6">
      <div>
        <h1>Профиль</h1>
        <p className="text-sm text-neutral-400 mt-1">Информация об аккаунте и активности</p>
      </div>

      <div className="card flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-primary-300 flex items-center justify-center">
          <UserIcon className="h-8 w-8 text-neutral-700" />
        </div>
        <div>
          <div className="text-lg font-semibold text-neutral-700">
            {user?.name || 'Без имени'}
          </div>
          <div className="text-sm text-neutral-400">{user?.email}</div>
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
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${hero ? 'bg-white/20 text-white' : 'bg-primary-200 text-primary-800'}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className={`text-xs ${hero ? 'text-primary-300' : 'text-neutral-500'}`}>{label}</div>
          <div className={`text-2xl font-bold ${hero ? 'text-white' : 'text-neutral-800'}`}>{value}</div>
        </div>
      </div>
    </div>
  );
}
