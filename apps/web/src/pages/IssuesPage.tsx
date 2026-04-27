import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Package, RefreshCw, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useHiddenIssues, useIssueDetail, useRecomputeIssues } from '../lib/queries';
import { ProductSelector } from '../components/ProductSelector';
import { AnalysisBanner } from '../components/AnalysisBanner';
import { useProductStore } from '../store/product.store';

export function IssuesPage() {
  const { selectedProductId } = useProductStore();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useHiddenIssues(selectedProductId, page, 20);
  const recompute = useRecomputeIssues();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [selectedProductId]);

  const handleRecompute = async () => {
    try {
      const res = await recompute.mutateAsync(selectedProductId);
      toast.success(
        `Готово: ${res.clustersCreated} кластеров, ${res.reviewsAssigned} отзывов привязано`,
      );
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Ошибка пересчёта');
    }
  };

  const issues = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-primary-500" />
            Скрытые проблемы
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            Кластеры повторяющихся жалоб, ранжированные по скрытости и серьёзности
          </p>
        </div>
        <button
          onClick={handleRecompute}
          disabled={recompute.isPending}
          className="btn-primary"
        >
          {recompute.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {selectedProductId ? 'Пересчитать для товара' : 'Пересчитать все'}
        </button>
      </div>

      <ProductSelector />
      <AnalysisBanner />

      <div className="card bg-primary-50 border-primary-200">
        <h3 className="mb-2 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary-700" />
          Что такое «скрытая» проблема?
        </h3>
        <p className="text-sm text-neutral-600">
          Это проблема, которая встречается редко (низкая видимость), но почти всегда сопровождается
          сильным негативом (высокая серьёзность). Такие проблемы легко пропустить при ручном
          просмотре, но они критичны для качества товара.
        </p>
        <p className="text-sm text-neutral-500 mt-2">
          <strong>hidden_score = severity × (1 − visibility)</strong>
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-5 bg-neutral-200 rounded w-2/3 mb-2" />
              <div className="h-3 bg-neutral-100 rounded w-full mb-4" />
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((j) => <div key={j} className="h-8 bg-neutral-100 rounded" />)}
              </div>
            </div>
          ))}
        </div>
      ) : issues.length === 0 ? (
        <div className="card text-center py-12">
          <AlertTriangle className="h-10 w-10 mx-auto text-neutral-300 mb-3" />
          <p className="text-sm text-neutral-400">
            Кластеры пока не сформированы. Запустите анализ отзывов и нажмите «Пересчитать».
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => (
            <div key={issue.id} className="card hover:border-primary-300 transition">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  {issue.product && (
                    <div className="mb-2">
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-primary-200 text-primary-800">
                        <Package className="h-3 w-3" />
                        {issue.product.name}
                      </span>
                    </div>
                  )}
                  <h3 className="text-neutral-700">{issue.title}</h3>
                  {issue.description && (
                    <p className="text-sm text-neutral-500 mt-1">{issue.description}</p>
                  )}
                  {issue.keywords && issue.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {issue.keywords.map((kw) => (
                        <span key={kw} className="badge bg-neutral-100 text-neutral-600">
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-semibold text-primary-700">
                    {(issue.hiddenScore * 100).toFixed(0)}
                  </div>
                  <div className="text-xs text-neutral-400">hidden score</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-neutral-100 text-xs">
                <Stat label="Отзывов" value={issue.size.toString()} />
                <Stat label="Серьёзность" value={`${(issue.severity * 100).toFixed(0)}%`} />
                <Stat label="Видимость" value={`${(issue.visibility * 100).toFixed(2)}%`} />
              </div>

              <button
                onClick={() => setExpandedId(expandedId === issue.id ? null : issue.id)}
                className="mt-3 flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 transition"
              >
                {expandedId === issue.id ? (
                  <><ChevronUp className="h-3.5 w-3.5" /> Скрыть отзывы</>
                ) : (
                  <><ChevronDown className="h-3.5 w-3.5" /> Показать отзывы ({issue.size})</>
                )}
              </button>

              {expandedId === issue.id && (
                <IssueReviews issueId={issue.id} />
              )}
            </div>
          ))}
        </div>
      )}

      {data && data.total > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 text-sm">
          <span className="text-neutral-400">
            {data.total} проблем всего
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className={clsx('btn-outline px-3 py-1', page === 1 && 'opacity-50')}
            >
              Назад
            </button>
            <span className="px-2 text-neutral-500">{page} / {totalPages}</span>
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
  );
}

function IssueReviews({ issueId }: { issueId: string }) {
  const { data, isLoading } = useIssueDetail(issueId);
  const reviews = data?.reviews ?? [];

  if (isLoading) {
    return (
      <div className="mt-3 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 bg-neutral-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (reviews.length === 0) {
    return <p className="mt-3 text-xs text-neutral-400">Нет привязанных отзывов</p>;
  }

  return (
    <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
      {reviews.map((r) => (
        <div key={r.id} className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
          <p className="text-neutral-700 line-clamp-2">{r.text}</p>
          <p className="text-xs text-neutral-400 mt-1">
            {r.rating ? `★ ${r.rating} · ` : ''}
            {new Date(r.createdAt).toLocaleDateString('ru-RU')}
            {r.sentimentScore != null && ` · score ${r.sentimentScore.toFixed(2)}`}
          </p>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-neutral-400">{label}</div>
      <div className="text-neutral-700 font-medium">{value}</div>
    </div>
  );
}
