import { useState } from 'react';
import { RefreshCw, MessageSquare, Star, AlertTriangle } from 'lucide-react';
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RunAnalytics, CalendarComparison } from '../components/RunAnalytics';
import { useStats, useTimeseries } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import { ScopeCounts } from '../components/ScopeCounts';
import { ErrorState, EmptyState, LoadingState } from '../components/QueryState';
import { PageHeader, Tabs, MetricCard, ChartCard } from '../components/ui';
import {
  SentimentTrend,
  SentimentDistribution,
  RatingDistribution,
} from '../components/AnalyticsCharts';

export function AnalyticsPage() {
  const { selectedProductId: productId, selectedRunId } = useProductStore();
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<'overview' | 'aspects' | 'dynamics' | 'comparison'>('overview');
  const stats = useStats(productId);
  const resolvedRunId = selectedRunId ?? stats.data?.scope.runId;
  const series = useTimeseries({
    productId,
    ...(resolvedRunId ? { runId: resolvedRunId } : {}),
    days,
    bucket: 'day',
  });
  const header = (
    <PageHeader
      title="Аналитика"
      description="Тональность, оценки и аспекты выбранного запуска"
      actions={
        <button
          className="btn-outline"
          onClick={() => {
            void stats.refetch();
            void series.refetch();
          }}
        >
          <RefreshCw className="h-4 w-4" />
          Обновить
        </button>
      }
    />
  );
  if (stats.isError)
    return (
      <div className="space-y-6">
        {header}
        <ErrorState error={stats.error} retry={stats.refetch} />
      </div>
    );
  if (stats.isPending)
    return (
      <div className="space-y-6">
        {header}
        <LoadingState>Загрузка аналитики…</LoadingState>
      </div>
    );
  const s = stats.data;
  if (!productId || !s.hasRun)
    return (
      <div className="space-y-6">
        {header}
        <ScopeCounts stats={s} />
        <EmptyState title={!productId ? 'Выберите товар' : 'Нет результата анализа'}>
          Выберите сохранённый запуск или выполните анализ.
        </EmptyState>
      </div>
    );
  return (
    <div className="space-y-6">
      {header}
      <Tabs
        label="Разделы аналитики"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Обзор' },
          { value: 'aspects', label: 'Аспекты и жалобы' },
          { value: 'dynamics', label: 'Динамика' },
          { value: 'comparison', label: 'Сравнение периодов' },
        ]}
      />
      {tab === 'overview' && (
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            <MetricCard
              label="Обработано отзывов"
              icon={MessageSquare}
              value={s.succeededCount}
              detail={`Из ${s.scopeTotal ?? '—'} в запуске`}
            />
            <MetricCard
              label="Средняя оценка"
              icon={Star}
              tone="warning"
              value={s.avgRating?.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) ?? '—'}
              detail={`Известных оценок: ${s.analytics?.ratingCount ?? '—'}`}
            />
            <MetricCard
              label="Групп жалоб"
              icon={AlertTriangle}
              tone="negative"
              value={s.publicationId ? s.problemCount : null}
              detail="Все пользовательские состояния"
            />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <SentimentDistribution stats={s} />
            <RatingDistribution productId={productId} runId={resolvedRunId} />
          </div>
          <SentimentTrend productId={productId} runId={resolvedRunId} days={days} />
          <details className="card">
            <summary>Область и покрытие анализа</summary>
            <ScopeCounts stats={s} />
          </details>
        </>
      )}
      {tab === 'aspects' &&
        (s.analytics ? (
          <RunAnalytics summary={s.analytics} />
        ) : (
          <EmptyState title="Аспекты пока недоступны">
            Для этой области сервер не вернул сводку аспектов.
          </EmptyState>
        ))}
      {(tab === 'dynamics' || tab === 'comparison') && (
        <div className="flex flex-wrap justify-between items-center gap-3">
          <p className="text-sm text-neutral-500">
            Окно рассчитывается по датам исходных отзывов, UTC.
          </p>
          <label className="text-xs">
            Период графиков
            <select
              className="input mt-1"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              <option value={30}>30 дней</option>
              <option value={60}>60 дней</option>
              <option value={90}>90 дней</option>
            </select>
          </label>
        </div>
      )}
      {tab === 'dynamics' && (
        <>
          <SentimentTrend productId={productId} runId={resolvedRunId} days={days} />
          <ChartCard
            title="Доля отзывов с жалобами"
            description="Жалобы на товар / успешно обработанные отзывы дня"
          >
            {series.isError ? (
              <ErrorState error={series.error} retry={series.refetch} />
            ) : series.isPending ? (
              <LoadingState />
            ) : !series.data.buckets.some((row) => row.succeeded) ? (
              <EmptyState title="Нет данных за этот период" />
            ) : (
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series.data.buckets} margin={{ left: -15, right: 12, top: 10 }}>
                    <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={30}
                      tick={{ fill: 'var(--muted)', fontSize: 11 }}
                      tickFormatter={(value) => String(value).slice(5)}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--muted)', fontSize: 11 }}
                      domain={[0, 1]}
                      tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        const row = payload?.[0]?.payload as
                          | {
                              complaintCount: number;
                              succeeded: number;
                              complaintRate: number | null;
                            }
                          | undefined;
                        return active && row ? (
                          <div className="card text-xs">
                            {label}: {row.complaintCount}/{row.succeeded} ·{' '}
                            {row.complaintRate === null
                              ? 'не определено'
                              : `${(row.complaintRate * 100).toFixed(1)}%`}
                          </div>
                        ) : null;
                      }}
                    />
                    <Line
                      name="Доля жалоб"
                      dataKey="complaintRate"
                      stroke="#fb7185"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="text-xs text-neutral-500 mt-3">
              Без успешных результатов доля не определена: на линии показан разрыв.
            </p>
          </ChartCard>
        </>
      )}
      {tab === 'comparison' &&
        (series.isError ? (
          <ErrorState error={series.error} retry={series.refetch} />
        ) : series.isPending ? (
          <LoadingState />
        ) : series.data.comparison ? (
          <CalendarComparison calendar={series.data} />
        ) : (
          <EmptyState title="Сравнение недоступно">
            Для выбранной области нет данных сравнения периодов.
          </EmptyState>
        ))}
      {!s.publicationId && (
        <p className="card text-sm">
          Извлечение доступно, но группировка не опубликована. Число проблем ещё не определено.
        </p>
      )}
    </div>
  );
}
