import { AlertTriangle, Loader2, MessageSquare, RefreshCw, Star, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useState } from 'react';
import { useStats, useTimeseries } from '../lib/queries';
import { ProductSelector } from '../components/ProductSelector';
import { useProductStore } from '../store/product.store';

const SENTIMENT_COLORS = {
  positive: '#16A34A',
  negative: '#DC2626',
  neutral: '#9CA3AF',
};

function DeltaBadge({ current, previous, suffix = '' }: { current?: number; previous?: number; suffix?: string }) {
  if (current == null || previous == null || previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  const abs = Math.abs(delta).toFixed(1);
  if (Math.abs(delta) < 0.5) return <span className="text-xs text-neutral-400 flex items-center gap-0.5"><Minus className="h-3 w-3" /> {abs}{suffix}</span>;
  return delta > 0
    ? <span className="text-xs text-green-600 flex items-center gap-0.5"><TrendingUp className="h-3 w-3" />+{abs}{suffix}</span>
    : <span className="text-xs text-red-500 flex items-center gap-0.5"><TrendingDown className="h-3 w-3" />{abs}{suffix}</span>;
}

export function AnalyticsPage() {
  const { selectedProductId } = useProductStore();
  const [days, setDays] = useState(30);
  const stats = useStats(selectedProductId);
  const timeseries = useTimeseries({ bucket: 'day', days, productId: selectedProductId });

  // Compute prev-period deltas from first half of timeseries buckets
  const buckets = timeseries.data?.buckets ?? [];
  const half = Math.floor(buckets.length / 2);
  const prevHalf = buckets.slice(0, half);
  const currHalf = buckets.slice(half);
  const avgOf = (arr: typeof buckets, key: 'avgRating') => {
    const vals = arr.map((b) => b[key]).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
  };
  const countOf = (arr: typeof buckets, key: 'positive' | 'negative' | 'neutral') =>
    arr.reduce((s, b) => s + (b[key] ?? 0), 0);
  const prevNegPct = prevHalf.length
    ? (countOf(prevHalf, 'negative') / Math.max(1, countOf(prevHalf, 'positive') + countOf(prevHalf, 'negative') + countOf(prevHalf, 'neutral'))) * 100
    : undefined;
  const currNegPct = currHalf.length
    ? (countOf(currHalf, 'negative') / Math.max(1, countOf(currHalf, 'positive') + countOf(currHalf, 'negative') + countOf(currHalf, 'neutral'))) * 100
    : undefined;
  const prevAvgRating = avgOf(prevHalf, 'avgRating');
  const currAvgRating = avgOf(currHalf, 'avgRating');

  const s = stats.data;
  const pieData = s
    ? [
        { name: 'Позитивные', value: s.sentiment.positive, color: SENTIMENT_COLORS.positive },
        { name: 'Негативные', value: s.sentiment.negative, color: SENTIMENT_COLORS.negative },
        { name: 'Нейтральные', value: s.sentiment.neutral, color: SENTIMENT_COLORS.neutral },
      ].filter((d) => d.value > 0)
    : [];

  const hasRatingData = timeseries.data?.buckets.some((b) => b.avgRating != null) ?? false;

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

      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-500">Период:</span>
        {[30, 60, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`text-xs px-3 py-1 rounded-lg border transition font-medium ${
              days === d
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white dark:bg-neutral-800 text-neutral-500 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'
            }`}
          >
            {d} дней
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} hero={i < 2} />)
        ) : (
          <>
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
              extra={<DeltaBadge current={currNegPct} previous={prevNegPct} suffix="%" />}
            />
            <StatCard
              icon={Star}
              label="Средний рейтинг"
              value={s?.avgRating != null ? s.avgRating.toFixed(2) : '—'}
              accent="primary"
              extra={<DeltaBadge current={currAvgRating} previous={prevAvgRating} />}
            />
          </>
        )}
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
          <h3 className="mb-4">Динамика за {days} дней</h3>
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
                  <linearGradient id="neutralGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SENTIMENT_COLORS.neutral} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={SENTIMENT_COLORS.neutral} stopOpacity={0} />
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
                  dataKey="neutral"
                  stroke={SENTIMENT_COLORS.neutral}
                  fill="url(#neutralGrad)"
                  strokeWidth={2}
                  name="Нейтрал"
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

      {/* Rating trend */}
      <div className="card">
        <h3 className="mb-4">Средний рейтинг за {days} дней</h3>
        {timeseries.isLoading ? (
          <ChartSkeleton height={180} />
        ) : !hasRatingData ? (
          <Empty height={180}>Нет данных о рейтинге</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={timeseries.data!.buckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EDEDED" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8B8B8B' }} />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11, fill: '#8B8B8B' }} />
              <Tooltip formatter={(v: number) => v?.toFixed(2)} />
              <Line
                type="monotone"
                dataKey="avgRating"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={false}
                name="Ср. рейтинг"
                connectNulls
              />
            </LineChart>
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
  sub,
  hero = false,
  accent,
  extra,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  hero?: boolean;
  accent?: 'primary' | 'negative';
  extra?: React.ReactNode;
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
          {extra && <div className="mt-1">{extra}</div>}
        </div>
      </div>
    </div>
  );
}

function StatCardSkeleton({ hero = false }: { hero?: boolean }) {
  return (
    <div className={`${hero ? 'card-hero opacity-60' : 'card'} animate-pulse`}>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-neutral-200" />
        <div className="space-y-2">
          <div className="h-2.5 bg-neutral-200 rounded w-20" />
          <div className="h-6 bg-neutral-200 rounded w-12" />
        </div>
      </div>
    </div>
  );
}

function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className={`animate-pulse flex flex-col gap-3`} style={{ height }}>
      <div className="flex-1 bg-neutral-100 rounded-lg" />
      <div className="flex gap-2 justify-center">
        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-2 w-10 bg-neutral-200 rounded" />)}
      </div>
    </div>
  );
}

function Empty({ children, height = 280 }: { children: React.ReactNode; height?: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-neutral-400" style={{ height }}>
      {children}
    </div>
  );
}
