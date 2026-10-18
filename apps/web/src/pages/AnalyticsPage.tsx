import { RunAnalytics, CalendarComparison } from '../components/RunAnalytics';
import { useState } from 'react';
import { Area, AreaChart, Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStats, useTimeseries } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import { ScopeCounts } from '../components/ScopeCounts';
import { ErrorState, EmptyState, LoadingState } from '../components/QueryState';

export function AnalyticsPage() {
  const { selectedProductId: productId, selectedRunId } = useProductStore();
  const [days, setDays] = useState(30);
  const stats = useStats(productId);
  const resolvedRunId = selectedRunId ?? stats.data?.scope.runId;
  const series = useTimeseries({ productId, ...(resolvedRunId ? { runId: resolvedRunId } : {}), days, bucket: 'day' });
  if (stats.isError) return <div className="space-y-4"><h1>Аналитика</h1><ErrorState error={stats.error} retry={stats.refetch} /></div>;
  if (stats.isPending) return <LoadingState>Загрузка аналитики…</LoadingState>;
  const s = stats.data;
  if (!productId || !s.hasRun) return <div className="space-y-4"><h1>Аналитика</h1><ScopeCounts stats={s} /><EmptyState title={!productId ? 'Выберите товар' : 'Нет результата анализа'}>Выберите сохранённый запуск или выполните анализ. Загруженные данные и обработанная область учитываются отдельно.</EmptyState></div>;
  return <div className="space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1>Аналитика запуска</h1><p className="text-sm text-neutral-500 mt-1">Данные сохранённой области; новые импорты меняют только число загруженных отзывов.</p></div><button className="btn-outline" onClick={() => { void stats.refetch(); void series.refetch(); }}>Обновить данные</button></header>
    <ScopeCounts stats={s} />
    <section className="grid sm:grid-cols-3 gap-3"><div className="card"><p className="text-xs text-neutral-500">Группы повторяющихся жалоб (все состояния)</p><p className="text-2xl mt-1">{s.publicationId ? s.problemCount : '—'}</p></div><div className="card"><p className="text-xs text-neutral-500">Средняя известная оценка области</p><p className="text-2xl mt-1">{s.avgRating?.toFixed(2) ?? '—'}</p><p className="text-xs text-neutral-500">Известных оценок: {s.analytics?.ratingCount ?? '—'}</p></div><div className="card"><p className="text-xs text-neutral-500">Общая тональность успешных результатов</p><p className="text-sm mt-2">Положительная: {s.sentiment.positive} · Отрицательная: {s.sentiment.negative} · Нейтральная: {s.sentiment.neutral}</p></div></section>
    {s.analytics && <RunAnalytics summary={s.analytics} />}
    {!s.publicationId && <p className="card text-sm">Извлечение доступно, но группировка не опубликована. Число проблем ещё не определено.</p>}
    <section className="card space-y-4"><div className="flex flex-wrap gap-3 items-center justify-between"><h2 className="text-lg">Тональность по датам отзывов</h2><label className="text-sm">Окно графика<select className="input mt-1" value={days} onChange={event => setDays(Number(event.target.value))}><option value={30}>30 дней</option><option value={60}>60 дней</option><option value={90}>90 дней</option></select></label></div>
      {series.isError ? <ErrorState error={series.error} retry={series.refetch} /> : series.isPending ? <p role="status">Загрузка графика…</p> : !series.data.buckets.length ? <p>В выбранном окне нет отзывов с известной датой.</p> : <div className="h-72 min-w-0 text-neutral-600 dark:text-neutral-300"><ResponsiveContainer width="100%" height="100%"><AreaChart data={series.data.buckets}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={value => String(value).slice(5)} padding={{ left: 10, right: 15 }} /><YAxis allowDecimals={false} tick={{ fill: 'currentColor', fontSize: 11 }} /><Tooltip /><Area name="Положительная" dataKey="positive" stroke="#15803d" fill="#86efac" /><Area name="Отрицательная" dataKey="negative" stroke="#b91c1c" fill="#fca5a5" /><Area name="Нейтральная" dataKey="neutral" stroke="#64748b" fill="#cbd5e1" /></AreaChart></ResponsiveContainer></div>}
      <p className="text-xs text-neutral-500">Отзывы без даты: {series.data?.unknownDateCount ?? 'не определено'}. Дата импорта не заменяет дату отзыва. Пустые дни входят в окно. Частота жалоб нормализована по успешно обработанным отзывам.</p>
    </section>
    {series.data?.comparison && <section className="card space-y-3"><h2 className="text-lg">Доля отзывов с жалобами по датам</h2><p className="text-xs text-neutral-500">Жалобы на товар / успешно обработанные отзывы дня. Пустой знаменатель показан разрывом; подсказка содержит абсолютные числа.</p><div className="h-64 min-w-0 text-neutral-600 dark:text-neutral-300"><ResponsiveContainer width="100%" height="100%"><LineChart data={series.data.buckets}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={value => String(value).slice(5)} padding={{ left: 10, right: 15 }} /><YAxis tick={{ fill: 'currentColor', fontSize: 11 }} domain={[0, 1]} tickFormatter={value => `${Number(value) * 100}%`} /><Tooltip content={({ active, payload, label }) => { const row = payload?.[0]?.payload as { complaintCount: number; succeeded: number; complaintRate: number | null } | undefined; return active && row ? <div className="card text-sm">{label}: {row.complaintCount}/{row.succeeded} · {row.complaintRate === null ? 'не определено' : `${(row.complaintRate * 100).toFixed(1)}%`}</div> : null; }} /><Line name="Доля жалоб" dataKey="complaintRate" stroke="#b91c1c" connectNulls={false} /></LineChart></ResponsiveContainer></div></section>}
    {series.data && <CalendarComparison calendar={series.data} />}
  </div>;
}
