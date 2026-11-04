import { useQuery } from '@tanstack/react-query';
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
import { Star } from 'lucide-react';
import { useTimeseries, type OverviewStats, type ReviewsListResponse } from '../lib/queries';
import { useDataScope, useOwnerId } from '../lib/data-scope';
import { api } from '../lib/api';
import { ChartCard } from './ui';
import { EmptyState, ErrorState, LoadingState } from './QueryState';

export const sentimentColors = { positive: '#22c55e', neutral: '#94a3b8', negative: '#fb7185' };
export function SentimentLegend() {
  return (
    <div className="chart-legend">
      <span>
        <i className="legend-dot" style={{ background: sentimentColors.positive }} />
        Положительные
      </span>
      <span>
        <i className="legend-dot" style={{ background: sentimentColors.neutral }} />
        Нейтральные
      </span>
      <span>
        <i className="legend-dot" style={{ background: sentimentColors.negative }} />
        Отрицательные
      </span>
    </div>
  );
}
export function SentimentTrend({
  productId,
  runId,
  days = 30,
}: {
  productId: string;
  runId?: string | null;
  days?: number;
}) {
  const query = useTimeseries({ productId, ...(runId ? { runId } : {}), days, bucket: 'day' });
  return (
    <ChartCard title="Динамика тональности" description={`${days} дней · по датам отзывов`}>
      {query.isError ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : query.isPending ? (
        <LoadingState>Загрузка динамики…</LoadingState>
      ) : !query.data.buckets.some((row) => row.positive + row.negative + row.neutral > 0) ? (
        <EmptyState title="Нет данных для графика">
          В этом окне нет проанализированных отзывов с известной датой.
        </EmptyState>
      ) : (
        <>
          <SentimentLegend />
          <div
            className="chart-frame mt-4"
            role="img"
            aria-label="Количество положительных, нейтральных и отрицательных отзывов по дням"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={query.data.buckets}
                margin={{ top: 10, right: 8, left: -23, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={25}
                  tick={{ fill: 'var(--muted)', fontSize: 10 }}
                  tickFormatter={(value) => String(value).slice(5).split('-').reverse().join('.')}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--muted)', fontSize: 10 }}
                />
                <Tooltip labelFormatter={(value) => `Дата: ${value}`} />
                {(['neutral', 'negative', 'positive'] as const).map((key) => (
                  <Area
                    key={key}
                    name={
                      {
                        positive: 'Положительные',
                        negative: 'Отрицательные',
                        neutral: 'Нейтральные',
                      }[key]
                    }
                    type="monotone"
                    dataKey={key}
                    stroke={sentimentColors[key]}
                    fill={sentimentColors[key]}
                    fillOpacity={0.08}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      <p className="mt-3 text-[11px] text-neutral-500">
        Без даты отзыва: {query.data?.unknownDateCount ?? '—'}. Дата импорта не заменяет дату
        отзыва.
      </p>
    </ChartCard>
  );
}
export function RatingDistribution({
  productId,
  runId,
}: {
  productId: string;
  runId?: string | null;
}) {
  const scope = useDataScope(productId);
  const owner = useOwnerId();
  const params = { ...scope, ...(runId ? { runId } : {}) };
  // Request only the server total for each rating; never aggregate a partial page.
  const query = useQuery({
    queryKey: ['reviews', owner, params, 'rating-distribution'],
    enabled: !!runId,
    queryFn: async () =>
      Promise.all(
        [5, 4, 3, 2, 1].map(async (rating) => ({
          rating,
          count: (
            await api.get<ReviewsListResponse>('/api/reviews', {
              params: { ...params, rating, page: 1, pageSize: 1 },
            })
          ).data.total,
        })),
      ),
  });
  const total = query.data?.reduce((sum, row) => sum + row.count, 0) ?? 0;
  return (
    <ChartCard title="Распределение оценок" description="Известные оценки выбранного запуска">
      {!runId ? (
        <EmptyState title="Нужен результат анализа">Выберите сохранённый запуск.</EmptyState>
      ) : query.isError ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : query.isPending ? (
        <LoadingState />
      ) : !total ? (
        <EmptyState title="Нет известных оценок" />
      ) : (
        <div className="space-y-5 py-3">
          {query.data.map((row) => (
            <div className="flex items-center gap-2.5 text-xs" key={row.rating}>
              <span className="w-3 font-medium">{row.rating}</span>
              <Star className="h-3 w-3 text-amber-500 fill-current" />
              <div className="h-3 flex-1 rounded bg-neutral-100 overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(row.count / total) * 100}%`,
                    background: ['#fb7185', '#fb923c', '#fbbf24', '#86d79b', '#4cc174'][
                      row.rating - 1
                    ],
                  }}
                />
              </div>
              <span className="w-10 text-right tabular-nums" title={`${row.count} из ${total}`}>
                {Math.round((row.count / total) * 100)}%
              </span>
            </div>
          ))}
          <p className="pt-2 text-[11px] text-neutral-500">
            {total.toLocaleString('ru-RU')} оценок · без оценки в распределение не входят
          </p>
        </div>
      )}
    </ChartCard>
  );
}
export function SentimentDistribution({ stats }: { stats: OverviewStats }) {
  const data = (
    [
      ['Положительные', stats.sentiment.positive, sentimentColors.positive],
      ['Нейтральные', stats.sentiment.neutral, sentimentColors.neutral],
      ['Отрицательные', stats.sentiment.negative, sentimentColors.negative],
    ] as const
  ).map(([name, value, color]) => ({ name, value, color }));
  const total = data.reduce((sum, row) => sum + row.value, 0);
  return (
    <ChartCard title="Тональность отзывов" description="Успешные результаты выбранного запуска">
      {!total ? (
        <EmptyState title="Нет результатов тональности" />
      ) : (
        <>
          <div className="relative h-52 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={65}
                  outerRadius={86}
                  paddingAngle={3}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {data.map((row) => (
                    <Cell key={row.name} fill={row.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-center items-center">
              <strong className="text-2xl tabular-nums">{total.toLocaleString('ru-RU')}</strong>
              <span className="text-xs text-neutral-500">отзывов</span>
            </div>
          </div>
          <div className="space-y-2">
            {data.map((row) => (
              <div className="flex items-center gap-2 text-xs" key={row.name}>
                <i className="legend-dot" style={{ background: row.color }} />
                <span className="flex-1">{row.name}</span>
                <span className="tabular-nums font-medium">
                  {((row.value / total) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </ChartCard>
  );
}
