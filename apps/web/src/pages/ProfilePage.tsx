import { FileText, MessageSquare, Upload, User as UserIcon } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';

export function ProfilePage() {
  const { user } = useAuthStore();

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
        <StatCard icon={Upload} label="Загрузок" value="0" />
        <StatCard icon={MessageSquare} label="Отзывов проанализировано" value="0" />
        <StatCard icon={FileText} label="Отчётов" value="0" />
      </div>

      <div>
        <h2 className="mb-3">Мои отчёты</h2>
        <div className="card text-sm text-neutral-400 text-center py-8">
          Пока нет отчётов
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-neutral-400">{label}</div>
          <div className="text-2xl font-semibold text-neutral-700">{value}</div>
        </div>
      </div>
    </div>
  );
}
