import { Download, Filter, Loader2, Package, Play, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { connectSocket } from '../lib/socket';
import {
  useReviews,
  useRunAnalysis,
  useDeleteReview,
  useDeleteReviewsBulk,
  type ReviewListItem,
} from '../lib/queries';
import { ProductSelector } from '../components/ProductSelector';
import { AnalysisBanner } from '../components/AnalysisBanner';
import { useProductStore } from '../store/product.store';

const SENTIMENT_LABEL: Record<string, { label: string; cls: string }> = {
  positive: { label: 'позитив', cls: 'badge-positive' },
  negative: { label: 'негатив', cls: 'badge-negative' },
  neutral: { label: 'нейтрал', cls: 'badge-neutral' },
};

export function ReviewsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get('page') ?? '1');
  const sentiment = searchParams.get('sentiment') ?? '';
  const rating = searchParams.get('rating') ?? '';
  const hasIssues = searchParams.get('hasIssues') ?? '';
  const search = searchParams.get('search') ?? '';
  const [searchInput, setSearchInput] = useState(search);

  const setParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });
  };
  const setPage = (p: number) => setParam('page', p > 1 ? String(p) : '');
  const setSentiment = (v: string) => setParam('sentiment', v);
  const setRating = (v: string) => setParam('rating', v);
  const setHasIssues = (v: string) => setParam('hasIssues', v);
  const setSearch = (v: string) => setParam('search', v);

  const [selected, setSelected] = useState<ReviewListItem | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; step?: string; label?: string } | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const { selectedProductId } = useProductStore();
  const deleteReview = useDeleteReview();
  const deleteReviewsBulk = useDeleteReviewsBulk();

  const { data, isLoading, refetch } = useReviews({
    page,
    pageSize: 25,
    sentiment: sentiment || undefined,
    rating: rating ? Number(rating) : undefined,
    hasIssues: hasIssues === '' ? undefined : hasIssues === 'true',
    search: search || undefined,
    productId: selectedProductId ?? undefined,
  });

  const runAnalysis = useRunAnalysis();

  useEffect(() => {
    const socket = connectSocket();
    const onStep = (s: { step: string; label: string }) =>
      setProgress((prev) => prev ? { ...prev, step: s.step, label: s.label } : { processed: 0, total: 0, step: s.step, label: s.label });
    const onProgress = (p: { processed: number; total: number; step?: string }) =>
      setProgress((prev) => ({ processed: p.processed, total: p.total, step: p.step ?? prev?.step, label: prev?.label }));
    const onComplete = () => {
      setProgress(null);
      toast.success('Анализ завершён');
      refetch();
    };
    const onError = (e: { message: string }) => {
      setProgress(null);
      toast.error(e.message);
    };
    socket.on('analysis:step', onStep);
    socket.on('analysis:progress', onProgress);
    socket.on('analysis:complete', onComplete);
    socket.on('analysis:error', onError);
    return () => {
      socket.off('analysis:step', onStep);
      socket.off('analysis:progress', onProgress);
      socket.off('analysis:complete', onComplete);
      socket.off('analysis:error', onError);
    };
  }, [refetch]);

  const handleRunAnalysis = async () => {
    try {
      const res = await runAnalysis.mutateAsync(200);
      const socket = connectSocket();
      socket.emit('job:subscribe', res.jobId);
      setProgress({ processed: 0, total: 0 });
      toast(`Анализ запущен (job ${res.jobId.slice(-8)})`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Не удалось запустить анализ');
    }
  };

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  // Сбрасываем страницу при смене товара
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProductId]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const handleDeleteReview = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteReview.mutateAsync(id);
      toast.success('Отзыв удалён');
    } catch {
      toast.error('Не удалось удалить отзыв');
    }
  };

  const handleDeleteAll = async () => {
    try {
      const res = await deleteReviewsBulk.mutateAsync(selectedProductId);
      toast.success(`Удалено ${res.deleted} отзывов`);
      setPage(1);
    } catch {
      toast.error('Не удалось удалить');
    } finally {
      setConfirmDeleteAll(false);
    }
  };

  const handleExportCsv = () => {
    if (!data || data.items.length === 0) return;
    const headers = ['id', 'text', 'rating', 'sentiment', 'issues', 'date'];
    const rows = data.items.map((r) => [
      r.id,
      `"${r.text.replace(/"/g, '""')}"`,
      r.rating ?? '',
      r.sentiment ?? '',
      `"${(r.issues ?? []).join('; ')}"`,
      new Date(r.createdAt).toLocaleDateString('ru-RU'),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reviews-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1>Отзывы</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Все загруженные отзывы с результатами анализа
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              onClick={handleExportCsv}
              disabled={!data || data.items.length === 0}
              className="btn-outline"
              title="Экспорт в CSV"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
            {confirmDeleteAll ? (
              <>
                <span className="text-xs text-neutral-500">Удалить все?</span>
                <button
                  onClick={handleDeleteAll}
                  disabled={deleteReviewsBulk.isPending}
                  className="btn px-3 py-2 text-xs bg-red-600 text-white hover:bg-red-700"
                >
                  {deleteReviewsBulk.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Да'}
                </button>
                <button
                  onClick={() => setConfirmDeleteAll(false)}
                  className="btn-outline px-3 py-2 text-xs"
                >
                  Нет
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDeleteAll(true)}
                disabled={!data || data.total === 0}
                className="btn-outline text-red-600 border-red-200 hover:bg-red-50"
                title="Удалить все отзывы"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={handleRunAnalysis}
              disabled={runAnalysis.isPending || progress !== null}
              className="btn-primary"
            >
              {progress !== null ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {progress !== null ? 'Анализ...' : 'Запустить анализ'}
            </button>
          </div>
          {progress !== null && (
            <div className="w-64">
              <div className="flex justify-between text-xs text-neutral-500 mb-1">
                <span className="font-medium truncate max-w-[160px]">{progress.label ?? 'Анализ...'}</span>
                <span>{progress.processed}/{progress.total || '?'}</span>
              </div>
              <div className="h-1.5 w-full bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-300"
                  style={{
                    width: progress.total > 0
                      ? `${Math.round((progress.processed / progress.total) * 100)}%`
                      : '8%',
                  }}
                />
              </div>
              <div className="flex gap-2 mt-1.5">
                {['Тональность', 'Аспекты', 'Кластеры'].map((s, i) => (
                  <div key={s} className={`flex-1 h-1 rounded-full transition-all duration-500 ${
                    (progress.step === 'analyzing' && i === 0) ||
                    (progress.step === 'analyzing' && i === 1 && progress.processed > 0) ||
                    progress.step === 'done'
                      ? 'bg-primary-500' : 'bg-neutral-200'
                  }`} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ProductSelector />
      <AnalysisBanner />

      <div className="card sticky top-4 z-10 shadow-md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-neutral-400" />
            <span className="text-sm font-medium text-neutral-600">Фильтры</span>
            {(sentiment || rating || hasIssues || search) && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary-600 text-white">
                {[sentiment, rating, hasIssues, search].filter(Boolean).length}
              </span>
            )}
          </div>
          {(sentiment || rating || hasIssues || search) && (
            <button
              onClick={() => setSearchParams(new URLSearchParams())}
              className="text-xs text-neutral-400 hover:text-red-500 transition flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Сбросить фильтры
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <select
            value={sentiment}
            onChange={(e) => {
              setSentiment(e.target.value);
              setPage(1);
            }}
            className="input"
          >
            <option value="">Все тональности</option>
            <option value="positive">Позитивные</option>
            <option value="negative">Негативные</option>
            <option value="neutral">Нейтральные</option>
          </select>
          <select
            value={hasIssues}
            onChange={(e) => {
              setHasIssues(e.target.value);
              setPage(1);
            }}
            className="input"
          >
            <option value="">Все отзывы</option>
            <option value="true">С проблемами</option>
            <option value="false">Без проблем</option>
          </select>
          <select
            value={rating}
            onChange={(e) => {
              setRating(e.target.value);
              setPage(1);
            }}
            className="input"
          >
            <option value="">Любой рейтинг</option>
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                {r} ★
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Поиск по тексту..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSearch(searchInput);
                setPage(1);
              }
            }}
            className="input"
          />
          <button
            onClick={() => {
              setSearch(searchInput);
              setPage(1);
            }}
            className="btn-outline"
          >
            Применить
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
              <th className="pb-3 pr-3">Текст</th>
              <th className="pb-3 pr-3">Товар</th>
              <th className="pb-3 pr-3">Рейтинг</th>
              <th className="pb-3 pr-3">Тональность</th>
              <th className="pb-3 pr-3">Проблем</th>
              <th className="pb-3 pr-3">Дата</th>
              <th className="pb-3 w-8" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-neutral-50 animate-pulse">
                  <td className="py-3 pr-3"><div className="h-3 bg-neutral-200 rounded w-full" /></td>
                  <td className="py-3 pr-3"><div className="h-3 bg-neutral-100 rounded w-20" /></td>
                  <td className="py-3 pr-3"><div className="h-3 bg-neutral-100 rounded w-8" /></td>
                  <td className="py-3 pr-3"><div className="h-3 bg-neutral-100 rounded w-16" /></td>
                  <td className="py-3 pr-3"><div className="h-3 bg-neutral-100 rounded w-6" /></td>
                  <td className="py-3 pr-3"><div className="h-3 bg-neutral-100 rounded w-16" /></td>
                  <td className="py-3" />
                </tr>
              ))
            ) : !data || data.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-neutral-400">
                  Нет отзывов. Загрузите данные на странице «Загрузка».
                </td>
              </tr>
            ) : (
              data.items.map((r) => {
                const s = r.sentiment ? SENTIMENT_LABEL[r.sentiment] : null;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-neutral-50 hover:bg-primary-50 cursor-pointer transition group"
                    onClick={() => setSelected(r)}
                  >
                    <td className="py-3 pr-3 max-w-md truncate">{r.text}</td>
                    <td className="py-3 pr-3">
                      {r.product ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-primary-100 text-primary-800 max-w-[14rem] truncate">
                          <Package className="h-3 w-3 shrink-0" />
                          <span className="truncate">{r.product.name}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-3">{r.rating ?? '—'}</td>
                    <td className="py-3 pr-3">
                      {s ? <span className={s.cls}>{s.label}</span> : '—'}
                    </td>
                    <td className="py-3 pr-3">{r.issues?.length ?? '—'}</td>
                    <td className="py-3 pr-3 text-xs text-neutral-400">
                      {new Date(r.createdAt).toLocaleDateString('ru-RU')}
                    </td>
                    <td className="py-3 pl-1">
                      <button
                        onClick={(e) => handleDeleteReview(r.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-red-500 transition"
                        title="Удалить отзыв"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {data && data.total > 0 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-neutral-100 text-sm">
            <span className="text-neutral-400">
              Показано {data.items.length} из {data.total}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className={clsx('btn-outline px-3 py-1', page === 1 && 'opacity-50')}
              >
                Назад
              </button>
              <span className="px-2 text-neutral-500">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className={clsx('btn-outline px-3 py-1', page >= totalPages && 'opacity-50')}
              >
                Вперёд
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && <ReviewModal review={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ReviewModal({ review, onClose }: { review: ReviewListItem; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <h2>Детали отзыва</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <div className="text-xs text-neutral-400 mb-1">Текст</div>
            <p className="text-neutral-700 whitespace-pre-wrap">{review.text}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Detail label="Рейтинг" value={review.rating?.toString() ?? '—'} />
            <Detail
              label="Тональность"
              value={
                review.sentiment
                  ? `${review.sentiment} (${review.sentimentScore?.toFixed(2) ?? '—'})`
                  : '—'
              }
            />
            <Detail label="Дата" value={new Date(review.createdAt).toLocaleString('ru-RU')} />
            <Detail
              label="Проанализирован"
              value={
                review.analyzedAt
                  ? new Date(review.analyzedAt).toLocaleString('ru-RU')
                  : 'нет'
              }
            />
          </div>

          {review.aspects && review.aspects.length > 0 && (
            <div>
              <div className="text-xs text-neutral-400 mb-1">Аспекты</div>
              <div className="flex flex-wrap gap-2">
                {review.aspects.map((a, i) => (
                  <span
                    key={i}
                    className={
                      a.sentiment === 'positive'
                        ? 'badge-positive'
                        : a.sentiment === 'negative'
                          ? 'badge-negative'
                          : 'badge-neutral'
                    }
                  >
                    {a.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {review.issues && review.issues.length > 0 && (
            <div>
              <div className="text-xs text-neutral-400 mb-1">Выявленные проблемы</div>
              <ul className="list-disc list-inside text-neutral-700 space-y-1">
                {review.issues.map((iss, i) => (
                  <li key={i}>{iss}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="text-neutral-700">{value}</div>
    </div>
  );
}
