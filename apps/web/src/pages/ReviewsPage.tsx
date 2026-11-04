import { useEffect, useRef, useState } from 'react';
import { Download, Play, Trash2, X, Search, Loader2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  useReviews,
  useRunAnalysis,
  useCancelAnalysis,
  useDeleteReview,
  useDeleteReviewsBulk,
  type ReviewListItem,
} from '../lib/queries';
import { downloadFile } from '../lib/download';
import { useDataScope } from '../lib/data-scope';
import { apiErrorMessage } from '../lib/api';
import { AnalysisBanner } from '../components/AnalysisBanner';
import { LlmStatus } from '../components/LlmStatus';
import { AnalysisRunHistory } from '../components/AnalysisRunHistory';
import { useProductStore } from '../store/product.store';
import { useAnalysisStore } from '../store/analysis.store';
import { Modal } from '../components/Modal';
import { ReviewDetails, sourceNames } from '../components/ReviewDetails';
import { analysisStatusNames } from '../lib/run-labels';
import { ErrorState, EmptyState, LoadingState } from '../components/QueryState';
import {
  ConfirmDialog,
  DataTable,
  FilterBar,
  PageHeader,
  Rating,
  StatusBadge,
} from '../components/ui';

export function ReviewsPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const sentiment = params.get('sentiment') ?? '',
    rating = params.get('rating') ?? '',
    hasIssues = params.get('hasIssues') ?? '',
    search = params.get('search') ?? '';
  const [searchInput, setSearchInput] = useState(search);
  const setParam = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });
  const [selected, setSelected] = useState<ReviewListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReviewListItem | 'all' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<'new_only' | 'reanalyze'>('new_only');
  const { selectedProductId, selectedRunId } = useProductStore();
  const previousScope = useRef({ productId: selectedProductId, runId: selectedRunId });
  const scope = useDataScope(selectedProductId);
  const { jobId, progress, lastError, clearError } = useAnalysisStore();
  const cancel = useCancelAnalysis(),
    remove = useDeleteReview(),
    removeBulk = useDeleteReviewsBulk(),
    launch = useRunAnalysis();
  const query = useReviews({
    page,
    pageSize: 25,
    sentiment: sentiment || undefined,
    rating: rating ? Number(rating) : undefined,
    hasIssues: hasIssues === '' ? undefined : hasIssues === 'true',
    search: search || undefined,
    productId: selectedProductId ?? undefined,
  });
  useEffect(() => {
    setSearchInput(search);
  }, [search]);
  useEffect(() => {
    if (
      previousScope.current.productId === selectedProductId &&
      previousScope.current.runId === selectedRunId
    )
      return;
    previousScope.current = { productId: selectedProductId, runId: selectedRunId };
    setSelected(null);
    setDeleteTarget(null);
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [selectedProductId, selectedRunId, setParams]);
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  const start = async () => {
    try {
      await launch.mutateAsync({ limit: 200, mode: analysisMode });
      toast.success('Анализ запущен');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile('/api/reviews/export/csv', 'reviews.csv', {
        ...scope,
        sentiment: sentiment || undefined,
        rating: rating || undefined,
        hasIssues: hasIssues || undefined,
        search: search || undefined,
      });
      toast.success('Экспортирована вся отфильтрованная выборка');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setExporting(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget || selectedRunId) return;
    try {
      if (deleteTarget === 'all') {
        const result = await removeBulk.mutateAsync(selectedProductId);
        toast.success(`Удалено ${result.deleted} отзывов`);
        setParam('page', '');
      } else {
        await remove.mutateAsync(deleteTarget.id);
        toast.success('Отзыв удалён');
      }
      setDeleteTarget(null);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Все отзывы"
        description="Исходные тексты, оценки покупателей и результаты анализа"
        actions={
          <>
            <button
              className="btn-outline"
              onClick={() => void exportCsv()}
              disabled={exporting || !query.data?.total}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Экспорт CSV
            </button>
            <button
              className="btn-primary"
              disabled={launch.isPending || progress !== null || !selectedProductId}
              onClick={() => void start()}
            >
              <Play className="h-4 w-4" />
              {progress ? 'Анализ выполняется' : 'Запустить анализ'}
            </button>
          </>
        }
      />
      <AnalysisBanner />
      {lastError && (
        <div role="alert" className="card flex items-start gap-3 text-sm">
          <span className="flex-1">{lastError}</span>
          <button aria-label="Скрыть сообщение об анализе" onClick={clearError}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <details className="card">
        <summary>Параметры и история анализа</summary>
        <div className="space-y-4 mt-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              Режим анализа
              <select
                className="input mt-1"
                value={analysisMode}
                disabled={!!progress}
                onChange={(event) =>
                  setAnalysisMode(event.target.value as 'new_only' | 'reanalyze')
                }
              >
                <option value="new_only">Только новые отзывы</option>
                <option value="reanalyze">Повторно всю выбранную область</option>
              </select>
            </label>
            {progress && jobId && (
              <button
                className="btn-outline"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(jobId, { onError: (error) => toast.error(apiErrorMessage(error)) })
                }
              >
                Остановить анализ
              </button>
            )}
          </div>
          <LlmStatus />
          <AnalysisRunHistory />
        </div>
      </details>
      <FilterBar
        active={!!(sentiment || rating || hasIssues || search)}
        onReset={() => setParams(new URLSearchParams())}
      >
        <label className="!flex-[2]">
          Поиск по тексту
          <div className="relative mt-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
            <input
              type="search"
              aria-label="Поиск по тексту отзывов"
              maxLength={200}
              className="input !pl-9"
              placeholder="Слово или фраза…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setParam('search', searchInput.trim());
              }}
            />
          </div>
        </label>
        <label>
          Тональность
          <select
            className="input mt-1"
            aria-label="Тональность отзывов"
            value={sentiment}
            onChange={(event) => setParam('sentiment', event.target.value)}
          >
            <option value="">Все тональности</option>
            <option value="positive">Положительная</option>
            <option value="negative">Отрицательная</option>
            <option value="neutral">Нейтральная</option>
          </select>
        </label>
        <label>
          Оценка
          <select
            className="input mt-1"
            aria-label="Рейтинг отзывов"
            value={rating}
            onChange={(event) => setParam('rating', event.target.value)}
          >
            <option value="">Любая оценка</option>
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {value} ★
              </option>
            ))}
          </select>
        </label>
        <label>
          Жалобы
          <select
            className="input mt-1"
            aria-label="Наличие проблем"
            value={hasIssues}
            onChange={(event) => setParam('hasIssues', event.target.value)}
          >
            <option value="">Все отзывы</option>
            <option value="true">С проблемами</option>
            <option value="false">Без проблем</option>
          </select>
        </label>
        <button className="btn-outline" onClick={() => setParam('search', searchInput.trim())}>
          Найти
        </button>
      </FilterBar>
      {query.isError ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : query.isPending ? (
        <LoadingState>Загрузка отзывов…</LoadingState>
      ) : !query.data.items.length ? (
        <EmptyState
          title={
            search || sentiment || rating || hasIssues ? 'Ничего не найдено' : 'Отзывов пока нет'
          }
        >
          Измените фильтры или добавьте отзывы в разделе «Импорт отзывов».
        </EmptyState>
      ) : (
        <section className="card !p-0 overflow-hidden">
          <DataTable label="Отзывы покупателей с горизонтальной прокруткой" minWidth="60rem">
            <thead>
              <tr>
                <th>Оценка</th>
                <th className="w-[34%]">Отзыв</th>
                <th>Аспекты</th>
                <th>Тональность</th>
                <th>Дата отзыва</th>
                <th>
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((review) => (
                <tr key={review.id}>
                  <td>
                    <Rating value={review.rating} />
                  </td>
                  <td>
                    <button
                      className="text-left leading-relaxed line-clamp-3 hover:text-primary-700"
                      aria-label={`Открыть отзыв: ${review.text.slice(0, 80)}`}
                      onClick={() => setSelected(review)}
                    >
                      {review.text}
                    </button>
                    <p className="text-[11px] text-neutral-500 mt-2 break-words">
                      {review.product?.name ?? 'Товар не указан'} ·{' '}
                      {sourceNames[review.source ?? ''] ?? review.source ?? 'Источник не указан'}
                    </p>
                    <p className="text-[11px] text-neutral-500 mt-1">
                      {review.analysisStatus
                        ? analysisStatusNames[review.analysisStatus]
                        : 'Результат зависит от выбранного запуска'}
                      {' · Жалоб: '}
                      {review.issues?.length ?? '—'}
                    </p>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1 max-w-48">
                      {review.aspects?.length ? (
                        review.aspects.slice(0, 3).map((aspect, i) => (
                          <span
                            key={i}
                            className={
                              aspect.sentiment === 'negative'
                                ? 'badge-negative'
                                : aspect.sentiment === 'positive'
                                  ? 'badge-positive'
                                  : 'badge-neutral'
                            }
                          >
                            {aspect.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-neutral-500">—</span>
                      )}
                      {(review.aspects?.length ?? 0) > 3 && (
                        <button
                          className="text-xs text-primary-700"
                          onClick={() => setSelected(review)}
                        >
                          +{review.aspects!.length - 3}
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <StatusBadge
                      tone={
                        review.sentiment === 'positive'
                          ? 'positive'
                          : review.sentiment === 'negative'
                            ? 'negative'
                            : 'neutral'
                      }
                    >
                      {review.sentiment
                        ? {
                            positive: 'Положительная',
                            negative: 'Отрицательная',
                            neutral: 'Нейтральная',
                          }[review.sentiment]
                        : 'Не определена'}
                    </StatusBadge>
                  </td>
                  <td className="text-xs text-neutral-500 whitespace-nowrap">
                    {review.reviewDate
                      ? new Date(review.reviewDate).toLocaleDateString('ru-RU')
                      : 'Не указана'}
                  </td>
                  <td>
                    <button
                      className="btn-ghost !px-2 hover:!text-red-600"
                      disabled={!!selectedRunId || remove.isPending}
                      aria-label="Удалить отзыв"
                      title={
                        selectedRunId
                          ? 'Снимок запуска доступен только для чтения'
                          : 'Удалить отзыв'
                      }
                      onClick={() => setDeleteTarget(review)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <footer className="flex flex-wrap justify-between items-center gap-3 p-4 text-xs text-neutral-500">
            <span>
              Показано {query.data.items.length} из {query.data.total.toLocaleString('ru-RU')}
            </span>
            <div className="flex items-center gap-2">
              <button
                className="btn-outline !px-3"
                disabled={page === 1}
                onClick={() => setParam('page', String(page - 1))}
              >
                Назад
              </button>
              <span className="tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                className="btn-outline !px-3"
                disabled={page >= totalPages}
                onClick={() => setParam('page', String(page + 1))}
              >
                Вперёд
              </button>
            </div>
          </footer>
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">
          {selectedRunId
            ? 'Сохранённый снимок запуска. Удаление исходных отзывов здесь недоступно.'
            : 'Показаны исходные отзывы выбранной области.'}
        </p>
        <button
          className="btn-ghost !text-red-600"
          disabled={!!selectedRunId || !query.data?.total}
          onClick={() => setDeleteTarget('all')}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Удалить все отзывы
        </button>
      </div>
      {selected && (
        <Modal title="Детали отзыва" onClose={() => setSelected(null)}>
          <ReviewDetails review={selected} />
        </Modal>
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget === 'all' ? 'Удалить все отзывы?' : 'Удалить отзыв?'}
          busy={remove.isPending || removeBulk.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        >
          {deleteTarget === 'all'
            ? `Будут удалены все исходные отзывы ${selectedProductId ? 'выбранного товара' : 'вашего аккаунта'}, включая отзывы вне текущих фильтров.`
            : 'Исходный отзыв будет удалён. Это действие нельзя отменить.'}
        </ConfirmDialog>
      )}
    </div>
  );
}
