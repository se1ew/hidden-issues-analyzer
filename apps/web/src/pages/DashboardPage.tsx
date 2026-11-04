import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Frown,
  MessageSquare,
  Play,
  Smile,
  Sparkles,
  Star,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStats, useRunAnalysis, useAiSummary } from '../lib/queries';
import { useGroupings, type RunGroup } from '../lib/grouping-queries';
import { useProductStore } from '../store/product.store';
import { useAnalysisStore } from '../store/analysis.store';
import { ErrorState, EmptyState, LoadingState } from '../components/QueryState';
import { ScopeCounts } from '../components/ScopeCounts';
import { PageHeader, MetricCard, ChartCard, StatusBadge } from '../components/ui';
import { SentimentTrend, RatingDistribution } from '../components/AnalyticsCharts';
import { AiSummaryModal } from '../components/AiSummaryModal';
import { AnalysisBanner } from '../components/AnalysisBanner';
import { problemLink } from '../lib/problem-links';
import { apiErrorMessage } from '../lib/api';
import toast from 'react-hot-toast';

export function DashboardPage() {
  const { selectedProductId: productId, selectedRunId } = useProductStore();
  const active = useAnalysisStore((state) => state.jobId);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const summary = useAiSummary(productId);
  const resetSummary = summary.reset;
  useEffect(() => {
    setSummaryOpen(false);
    resetSummary();
  }, [productId, resetSummary]);
  const stats = useStats(productId);
  const launch = useRunAnalysis();
  const navigate = useNavigate();
  const runId = selectedRunId ?? stats.data?.scope.runId ?? '';
  const fresh = useGroupings(productId, runId, '', 1, {
    status: 'new',
    issueScope: 'product',
    sort: 'priority',
    direction: 'desc',
  });
  const hidden = useGroupings(productId, runId, '', 1, {
    hiddenOnly: true,
    issueScope: 'product',
    sort: 'priority',
    direction: 'desc',
  });
  const start = async () => {
    try {
      await launch.mutateAsync(undefined);
      navigate('/reviews');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };
  const header = (
    <PageHeader
      title="Обзор"
      description="Ключевые результаты анализа отзывов о вашем товаре"
      actions={
        <>
          <Link to="/upload" className="btn-outline">
            Импорт отзывов
          </Link>
          <button
            className="btn-primary"
            disabled={!productId || !stats.data?.loadedTotal || launch.isPending || !!active}
            onClick={() => void start()}
          >
            <Play className="h-4 w-4" />
            {active ? 'Анализ выполняется' : 'Запустить анализ'}
          </button>
        </>
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
        <LoadingState>Загрузка обзора…</LoadingState>
      </div>
    );
  const s = stats.data;
  if (!productId)
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title="Начните с выбора товара">
          Выберите товар в верхней панели или добавьте первый, чтобы исследовать отзывы и находить
          скрытые проблемы.
          <div className="mt-5">
            <Link className="btn-primary" to="/products">
              Перейти к товарам
            </Link>
          </div>
        </EmptyState>
      </div>
    );
  const sentimentTotal = s.sentiment.positive + s.sentiment.negative + s.sentiment.neutral;
  const pct = (value: number) =>
    s.hasRun && sentimentTotal ? `${((value / sentimentTotal) * 100).toFixed(1)}%` : '—';
  return (
    <div className="space-y-6">
      {header}
      <AnalysisBanner />
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <MetricCard
          label="Загружено отзывов"
          value={s.loadedTotal.toLocaleString('ru-RU')}
          icon={MessageSquare}
          detail="Всего в выбранном товаре"
        />
        <MetricCard
          label="Средняя оценка"
          value={s.avgRating?.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) ?? '—'}
          icon={Star}
          tone="warning"
          detail="Известные оценки области запуска"
        />
        <MetricCard
          label="Положительных"
          value={pct(s.sentiment.positive)}
          icon={Smile}
          tone="positive"
          hint="Доля среди результатов с определённой тональностью выбранного запуска."
          detail={s.hasRun ? `${s.sentiment.positive} отзывов` : 'Выполните анализ'}
        />
        <MetricCard
          label="Отрицательных"
          value={pct(s.sentiment.negative)}
          icon={Frown}
          tone="negative"
          detail={s.hasRun ? `${s.sentiment.negative} отзывов` : 'Выполните анализ'}
        />
        <MetricCard
          label="Скрытых проблем"
          value={s.hiddenProblemCount}
          icon={AlertTriangle}
          hint="Повторяющиеся жалобы в положительном контексте по правилам опубликованной группировки. Все пользовательские состояния."
          detail={
            s.newProblemCount === null
              ? 'Группировка ещё не опубликована'
              : `Новых карточек: ${s.newProblemCount}`
          }
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {s.hasRun ? (
          <SentimentTrend productId={productId} runId={runId} />
        ) : (
          <ChartCard title="Динамика тональности">
            <EmptyState title="Нужен результат анализа">
              Запустите анализ отзывов, чтобы увидеть динамику тональности.
            </EmptyState>
          </ChartCard>
        )}
        <RatingDistribution productId={productId} runId={runId} />
        <ChartCard
          title="AI-инсайты"
          actions={
            <span className="metric-icon tone-brand">
              <Sparkles className="h-4 w-4" />
            </span>
          }
        >
          <ul className="space-y-4 text-sm leading-relaxed">
            <li className="flex gap-2">
              <CheckCircle2 className="h-4 w-4 mt-1 shrink-0 text-green-600" />
              <span>
                {s.newProblemCount === null
                  ? 'Запустите анализ, чтобы получить новые карточки проблем.'
                  : `Новых карточек для проверки: ${s.newProblemCount}.`}
              </span>
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="h-4 w-4 mt-1 shrink-0 text-green-600" />
              <span>
                {s.hiddenProblemCount === null
                  ? 'После публикации будут доступны жалобы в положительных отзывах.'
                  : `Групп жалоб в положительном контексте: ${s.hiddenProblemCount}.`}
              </span>
            </li>
            <li className="text-xs text-neutral-500">
              Сводка модели формируется отдельно по отзывам товара и может отличаться по области от
              выбранного запуска.
            </li>
          </ul>
          <button
            className="btn-soft w-full mt-5"
            disabled={!s.loadedTotal || summary.isPending}
            onClick={() =>
              summary.mutate(undefined, {
                onSuccess: () => {
                  if (useProductStore.getState().selectedProductId === productId)
                    setSummaryOpen(true);
                },
                onError: (error) => toast.error(apiErrorMessage(error)),
              })
            }
          >
            <Sparkles className="h-4 w-4" />
            {summary.isPending ? 'Формирование сводки…' : 'Сформировать AI-сводку'}
          </button>
        </ChartCard>
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
        <ProblemList
          title="Новые проблемы"
          count={s.newProblemCount}
          query={fresh}
          statsPublication={s.publicationId}
          productId={productId}
          runId={runId}
        />
        <ProblemList
          title="Жалобы в положительных отзывах"
          count={s.hiddenProblemCount}
          query={hidden}
          statsPublication={s.publicationId}
          productId={productId}
          runId={runId}
        />
      </div>
      <section
        className="card flex flex-wrap items-center justify-between gap-4"
        aria-label="Необходимые действия"
      >
        <div className="max-w-2xl">
          <h2 className="text-sm">Следующий шаг</h2>
          <p className="text-sm text-neutral-500 mt-1">
            {!s.loadedTotal
              ? 'Добавьте отзывы для анализа.'
              : !s.hasRun
                ? 'У товара пока нет опубликованного результата.'
                : s.failedCount
                  ? `Не удалось обработать ${s.failedCount} отзывов. Повторите ошибки в истории запусков.`
                  : !s.publicationId
                    ? 'Группировка ещё не опубликована. Проверьте запуск или повторите группировку на странице проблем.'
                    : s.newProblemCount
                      ? `Проверьте новые карточки проблем: ${s.newProblemCount}.`
                      : 'Можно изучить доказательства или загрузить новую партию отзывов.'}
          </p>
        </div>
        <Link className="btn-outline" to="/reviews">
          Отзывы и запуски
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
      <details className="card">
        <summary>Область анализа и покрытие</summary>
        <ScopeCounts stats={s} />
        <p className="text-xs text-neutral-500 mt-4">
          Группы повторяющихся жалоб (все состояния): {s.problemCount ?? '—'}. Отдельные сигналы:{' '}
          {s.signalCount ?? '—'}. Приоритет задаёт порядок проверки, а не измеренную критичность.
        </p>
      </details>
      {summaryOpen && summary.data && (
        <AiSummaryModal summary={summary.data} onClose={() => setSummaryOpen(false)} />
      )}
    </div>
  );
}
function ProblemList({
  title,
  count,
  query,
  statsPublication,
  productId,
  runId,
}: {
  title: string;
  count: number | null;
  query: ReturnType<typeof useGroupings>;
  statsPublication: string | null;
  productId: string;
  runId: string;
}) {
  return (
    <ChartCard title={title} actions={<StatusBadge>{count ?? '—'}</StatusBadge>}>
      {query.isError ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : !statsPublication ? (
        <EmptyState title="Ожидаем результат анализа">
          У области пока нет опубликованных групп.
        </EmptyState>
      ) : query.isPending ? (
        <LoadingState>Загрузка групп…</LoadingState>
      ) : query.data.publication?.id !== statsPublication ? (
        <p role="status" className="text-sm">
          Обновление публикации…
        </p>
      ) : !query.data.items.length ? (
        <EmptyState title="Таких групп не найдено" />
      ) : (
        <ul className="divide-y divide-neutral-100">
          {query.data.items.slice(0, 3).map((group: RunGroup, index) => (
            <li key={group.id}>
              <Link
                className="flex gap-3 py-4 group"
                to={problemLink({
                  id: group.id,
                  productId,
                  runId,
                  publicationId: query.data.publication!.id,
                })}
              >
                <span className="flex h-6 w-6 shrink-0 rounded-full items-center justify-center bg-primary-50 text-primary-700 text-xs font-semibold">
                  {index + 1}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-semibold block group-hover:text-primary-600 break-words">
                    {group.title}
                  </span>
                  <span className="text-xs text-neutral-500 block mt-1">
                    {group.metrics.support} уникальных отзывов · В положительном контексте:{' '}
                    {group.metrics.positiveContextCount}/{group.metrics.support}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-neutral-400 shrink-0 mt-1" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        className="inline-flex items-center gap-2 mt-4 text-xs font-medium text-primary-700"
        to="/issues"
      >
        Все проблемы выбранной области
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </ChartCard>
  );
}
