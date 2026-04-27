import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Circle, Download, HelpCircle, Loader2, Package, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useHiddenIssues, useIssueDetail, useRecomputeIssues, useToggleResolved } from '../lib/queries';
import { ProductSelector } from '../components/ProductSelector';
import { AnalysisBanner } from '../components/AnalysisBanner';
import { useProductStore } from '../store/product.store';

function getSeverityLevel(score: number) {
  if (score >= 0.7) return { label: 'Критично', bg: 'bg-red-100', text: 'text-red-700', bar: 'bg-red-500' };
  if (score >= 0.4) return { label: 'Важно',    bg: 'bg-amber-100', text: 'text-amber-700', bar: 'bg-amber-500' };
  return               { label: 'Низкий',  bg: 'bg-green-100', text: 'text-green-700', bar: 'bg-green-500' };
}

type SevFilter = 'all' | 'critical' | 'important' | 'low';

function matchSeverity(score: number, f: SevFilter) {
  if (f === 'all') return true;
  if (f === 'critical') return score >= 0.7;
  if (f === 'important') return score >= 0.4 && score < 0.7;
  return score < 0.4;
}

export function IssuesPage() {
  const { selectedProductId } = useProductStore();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sevFilter, setSevFilter] = useState<SevFilter>('all');
  const { data, isLoading } = useHiddenIssues(selectedProductId, page, 50);
  const recompute = useRecomputeIssues();
  const toggleResolved = useToggleResolved();
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

  const allIssues = data?.items ?? [];
  const issues = allIssues
    .filter((i) => matchSeverity(i.hiddenScore, sevFilter))
    .filter((i) => !search.trim() || i.title.toLowerCase().includes(search.trim().toLowerCase()));
  const totalPages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;

  const exportCsv = () => {
    const rows = [
      ['Проблема', 'Описание', 'Серьёзность', 'Score', 'Отзывов', 'Видимость', 'Товар'],
      ...allIssues.map((i) => [
        i.title,
        i.description ?? '',
        getSeverityLevel(i.hiddenScore).label,
        (i.hiddenScore * 100).toFixed(0),
        i.size.toString(),
        (i.visibility * 100).toFixed(1) + '%',
        i.product?.name ?? '',
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `issues_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast.success('CSV скачан');
  };

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
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={allIssues.length === 0} className="btn-outline gap-2">
            <Download className="h-4 w-4" /> CSV
          </button>
          <button onClick={handleRecompute} disabled={recompute.isPending} className="btn-primary">
            {recompute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {selectedProductId ? 'Пересчитать для товара' : 'Пересчитать все'}
          </button>
        </div>
      </div>

      <ProductSelector />
      <AnalysisBanner />

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="input pl-8 py-1.5 text-sm h-9"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="h-3.5 w-3.5 text-neutral-400" />
            </button>
          )}
        </div>
        {(['all', 'critical', 'important', 'low'] as SevFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setSevFilter(f)}
            className={clsx(
              'text-xs px-3 py-1.5 rounded-lg font-medium transition border',
              sevFilter === f
                ? f === 'all' ? 'bg-primary-600 text-white border-primary-600'
                  : f === 'critical' ? 'bg-red-100 text-red-700 border-red-300'
                  : f === 'important' ? 'bg-amber-100 text-amber-700 border-amber-300'
                  : 'bg-green-100 text-green-700 border-green-300'
                : 'bg-white dark:bg-neutral-800 text-neutral-500 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400',
            )}
          >
            {f === 'all' ? 'Все' : f === 'critical' ? 'Критично' : f === 'important' ? 'Важно' : 'Низкий'}
          </button>
        ))}
        {(search || sevFilter !== 'all') && (
          <button onClick={() => { setSearch(''); setSevFilter('all'); }} className="text-xs text-neutral-400 hover:text-red-500 transition">
            Сбросить
          </button>
        )}
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
          {issues.map((issue, idx) => {
            const sev = getSeverityLevel(issue.hiddenScore);
            return (
              <div
                key={issue.id}
                className={clsx('card hover:border-primary-300 transition animate-slide-in', issue.resolved && 'opacity-60')}
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${sev.bg} ${sev.text}`}>
                        {sev.label}
                      </span>
                      {issue.product && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-primary-100 text-primary-700">
                          <Package className="h-3 w-3" />
                          {issue.product.name}
                        </span>
                      )}
                    </div>
                    <h3 className="text-neutral-800 dark:text-neutral-100">{issue.title}</h3>
                    {issue.description && (
                      <p className="text-sm text-neutral-500 mt-1 line-clamp-2">{issue.description}</p>
                    )}
                    {issue.keywords && issue.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {issue.keywords.map((kw) => (
                          <span key={kw} className="text-xs px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <span className={`text-2xl font-bold ${sev.text}`}>
                        {(issue.hiddenScore * 100).toFixed(0)}
                      </span>
                      <span className="text-xs text-neutral-400">/100</span>
                      <div className="relative group">
                        <HelpCircle className="h-3.5 w-3.5 text-neutral-300 cursor-help" />
                        <div className="absolute right-0 top-5 w-56 p-2.5 text-xs bg-neutral-800 text-neutral-200 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition z-10">
                          Оценка серьёзности AI: чем выше — тем критичнее проблема.
                          <br /><span className="text-neutral-400">= severity × (1 − visibility)</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-neutral-400 mt-0.5">{issue.size} отзывов</div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
                    <span>Серьёзность: {(issue.severity * 100).toFixed(0)}%</span>
                    <span>Видимость: {(issue.visibility * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${sev.bar}`}
                      style={{ width: `${(issue.hiddenScore * 100).toFixed(0)}%` }}
                    />
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <button
                    onClick={() => setExpandedId(expandedId === issue.id ? null : issue.id)}
                    className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 transition"
                  >
                    {expandedId === issue.id ? (
                      <><ChevronUp className="h-3.5 w-3.5" /> Скрыть отзывы</>
                    ) : (
                      <><ChevronDown className="h-3.5 w-3.5" /> Показать отзывы ({issue.size})</>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      toggleResolved.mutate(issue.id);
                      if (!issue.resolved) toast.success('Проблема отмечена как решённая');
                    }}
                    className={clsx(
                      'flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition',
                      issue.resolved
                        ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                        : 'bg-white dark:bg-neutral-800 text-neutral-500 border-neutral-200 hover:border-green-400 hover:text-green-600',
                    )}
                  >
                    {issue.resolved
                      ? <><CheckCircle2 className="h-3.5 w-3.5" /> Решено</>
                      : <><Circle className="h-3.5 w-3.5" /> Отметить решённым</>}
                  </button>
                </div>

                {expandedId === issue.id && (
                  <IssueReviews issueId={issue.id} />
                )}
              </div>
            );
          })}
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
