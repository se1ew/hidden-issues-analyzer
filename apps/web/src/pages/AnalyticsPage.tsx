import { AlertTriangle, MessageSquare, Star, TrendingDown } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const SENTIMENT_COLORS = {
  positive: '#16A34A',
  negative: '#DC2626',
  neutral: '#9CA3AF',
};

export function AnalyticsPage() {
  // Заглушка — данные из API подключим позже
  const stats = {
    total: 0,
    avgRating: null as number | null,
    negativePct: 0,
    issuesCount: 0,
    sentiment: { positive: 0, negative: 0, neutral: 0 },
  };

  const pieData = [
    { name: 'Позитивные', value: stats.sentiment.positive, color: SENTIMENT_COLORS.positive },
    { name: 'Негативные', value: stats.sentiment.negative, color: SENTIMENT_COLORS.negative },
    { name: 'Нейтральные', value: stats.sentiment.neutral, color: SENTIMENT_COLORS.neutral },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1>Аналитика</h1>
          <p className="text-sm text-neutral-400 mt-1">Сводка по всем загруженным отзывам</p>
        </div>
        <button className="btn-outline">Обновить</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={MessageSquare} label="Всего отзывов" value={stats.total.toString()} />
        <StatCard
          icon={Star}
          label="Средний рейтинг"
          value={stats.avgRating?.toFixed(2) ?? '—'}
        />
        <StatCard
          icon={TrendingDown}
          label="% негативных"
          value={`${stats.negativePct.toFixed(1)}%`}
          accent="negative"
        />
        <StatCard
          icon={AlertTriangle}
          label="Скрытых проблем"
          value={stats.issuesCount.toString()}
          accent="primary"
        />
      </div>

      <div className="card">
        <h3 className="mb-4">Распределение тональностей</h3>
        {pieData.length === 0 ? (
          <div className="text-sm text-neutral-400 text-center py-12">
            Нет данных. Загрузите отзывы и запустите анализ.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
              >
                {pieData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: 'primary' | 'negative';
}) {
  const accentClass =
    accent === 'primary'
      ? 'bg-primary-100 text-primary-700'
      : accent === 'negative'
        ? 'bg-red-100 text-red-600'
        : 'bg-neutral-100 text-neutral-500';
  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${accentClass}`}>
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
