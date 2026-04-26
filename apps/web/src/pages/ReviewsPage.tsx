import { Filter, Loader2, Play, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { connectSocket } from '../lib/socket';
import {
  useReviews,
  useRunAnalysis,
  type ReviewListItem,
} from '../lib/queries';

const SENTIMENT_LABEL: Record<string, { label: string; cls: string }> = {
  positive: { label: 'позитив', cls: 'badge-positive' },
  negative: { label: 'негатив', cls: 'badge-negative' },
  neutral: { label: 'нейтрал', cls: 'badge-neutral' },
};

export function ReviewsPage() {
  const [page, setPage] = useState(1);
  const [sentiment, setSentiment] = useState<string>('');
  const [rating, setRating] = useState<string>('');
  const [hasIssues, setHasIssues] = useState<string>('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selected, setSelected] = useState<ReviewListItem | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);

  const { data, isLoading, refetch } = useReviews({
    page,
    pageSize: 25,
    sentiment: sentiment || undefined,
    rating: rating ? Number(rating) : undefined,
    hasIssues: hasIssues === '' ? undefined : hasIssues === 'true',
    search: search || undefined,
  });

  const runAnalysis = useRunAnalysis();

  useEffect(() => {
    const socket = connectSocket();
    const onProgress = (p: { processed: number; total: number }) =>
      setProgress({ processed: p.processed, total: p.total });
    const onComplete = () => {
      setProgress(null);
      toast.success('Анализ завершён');
      refetch();
    };
    const onError = (e: { message: string }) => {
      setProgress(null);
      toast.error(e.message);
    };
    socket.on('analysis:progress', onProgress);
    socket.on('analysis:complete', onComplete);
    socket.on('analysis:error', onError);
    return () => {
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

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1>Отзывы</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Все загруженные отзывы с результатами анализа
          </p>
        </div>
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
          {progress !== null
            ? `Анализ: ${progress.processed}/${progress.total || '?'}`
            : 'Запустить анализ'}
        </button>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-neutral-400" />
          <span className="text-sm font-medium text-neutral-600">Фильтры</span>
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
              <th className="pb-3 pr-3">Рейтинг</th>
              <th className="pb-3 pr-3">Тональность</th>
              <th className="pb-3 pr-3">Проблем</th>
              <th className="pb-3 pr-3">Дата</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="text-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary-500" />
                </td>
              </tr>
            ) : !data || data.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-neutral-400">
                  Нет отзывов. Загрузите данные на странице «Загрузка».
                </td>
              </tr>
            ) : (
              data.items.map((r) => {
                const s = r.sentiment ? SENTIMENT_LABEL[r.sentiment] : null;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-neutral-50 hover:bg-neutral-50 cursor-pointer"
                    onClick={() => setSelected(r)}
                  >
                    <td className="py-3 pr-3 max-w-md truncate">{r.text}</td>
                    <td className="py-3 pr-3">{r.rating ?? '—'}</td>
                    <td className="py-3 pr-3">
                      {s ? <span className={s.cls}>{s.label}</span> : '—'}
                    </td>
                    <td className="py-3 pr-3">{r.issues?.length ?? '—'}</td>
                    <td className="py-3 pr-3 text-xs text-neutral-400">
                      {new Date(r.createdAt).toLocaleDateString('ru-RU')}
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className={clsx('btn-outline px-3 py-1', page === 1 && 'opacity-50')}
              >
                Назад
              </button>
              <span className="px-2 text-neutral-500">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
