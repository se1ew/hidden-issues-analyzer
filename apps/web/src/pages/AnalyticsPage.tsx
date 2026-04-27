import { AlertTriangle, Loader2, MessageSquare, RefreshCw, Star, TrendingDown } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useStats, useTimeseries } from '../lib/queries';
import { ProductSelector } from '../components/ProductSelector';
import { useProductStore } from '../store/product.store';

const SENTIMENT_COLORS = {
  positive: '#16A34A',
  negative: '#DC2626',
  neutral: '#9CA3AF',
};

export function AnalyticsPage() {
  const { selectedProductId } = useProductStore();
  const stats = useStats(selectedProductId);
  const timeseries = useTimeseries({ bucket: 'day', days: 30, productId: selectedProductId });

  const s = stats.data;
  const pieData = s
    ? [
        { name: 'Позитивные', value: s.sentiment.positive, color: SENTIMENT_COLORS.positive },
        { name: 'Негативные', value: s.sentiment.negative, color: SENTIMENT_COLORS.negative },
        { name: 'Нейтральные', value: s.sentiment.neutral, color: SENTIMENT_COLORS.neutral },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1>Аналитика</h1>
          <p className="text-sm text-neutral-400 mt-1">Сводка по всем загруженным отзывам</p>
        </div>
        <button
          onClick={() => {
            stats.refetch();
            timeseries.refetch();
          }}
          disabled={stats.isFetching}
          className="btn-outline"
        >
          {stats.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Обновить
        </button>
      </div>

      <ProductSelector />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          hero
          icon={MessageSquare}
          label="Всего отзывов"
          value={s ? s.total.toString() : '—'}
          sub={s ? `проанализировано ${s.analyzed}` : undefined}
        />
        <StatCard
          hero
          icon={AlertTriangle}
          label="Скрытых проблем"
          value={s ? s.issuesCount.toString() : '—'}
        />
        <StatCard
          icon={TrendingDown}
          label="% негативных"
          value={s ? `${s.negativePct.toFixed(1)}%` : '—'}
          accent="negative"
        />
        <StatCard
          icon={Star}
          label="Средний рейтинг"
          value={s?.avgRating != null ? s.avgRating.toFixed(2) : '—'}
          accent="primary"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="mb-4">Распределение тональностей</h3>
          {stats.isLoading ? (
            <ChartSkeleton />
          ) : pieData.length === 0 ? (
            <Empty>Нет проанализированных отзывов</Empty>
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

        <div className="card">
          <h3 className="mb-4">Динамика за 30 дней</h3>
          {timeseries.isLoading ? (
            <ChartSkeleton />
          ) : !timeseries.data || timeseries.data.buckets.length === 0 ? (
            <Empty>Нет данных за выбранный период</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={timeseries.data.buckets}>
                <defs>
                  <linearGradient id="negativeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SENTIMENT_COLORS.negative} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={SENTIMENT_COLORS.negative} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="positiveGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SENTIMENT_COLORS.positive} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={SENTIMENT_COLORS.positive} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EDEDED" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8B8B8B' }} />
                <YAxis tick={{ fontSize: 11, fill: '#8B8B8B' }} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="positive"
                  stroke={SENTIMENT_COLORS.positive}
                  fill="url(#positiveGrad)"
                  strokeWidth={2}
                  name="Позитив"
                />
                <Area
                  type="monotone"
                  dataKey="negative"
                  stroke={SENTIMENT_COLORS.negative}
                  fill="url(#negativeGrad)"
                  strokeWidth={2}
                  name="Негатив"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  hero = false,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  hero?: boolean;
  accent?: 'primary' | 'negative';
}) {
  const iconClass = hero
    ? 'bg-white/20 text-white'
    : accent === 'primary'
      ? 'bg-primary-200 text-primary-800'
      : accent === 'negative'
        ? 'bg-red-100 text-red-700'
        : 'bg-primary-100 text-primary-700';
  return (
    <div className={hero ? 'card-hero' : 'card'}>
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${iconClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className={`text-xs ${hero ? 'text-primary-300' : 'text-neutral-500'}`}>{label}</div>
          <div className={`text-2xl font-bold ${hero ? 'text-white' : 'text-neutral-800'}`}>{value}</div>
          {sub && <div className={`text-xs mt-0.5 ${hero ? 'text-primary-300' : 'text-neutral-400'}`}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex items-center justify-center h-[280px]">
      <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-[280px] text-sm text-neutral-400">
      {children}
    </div>
  );
}
