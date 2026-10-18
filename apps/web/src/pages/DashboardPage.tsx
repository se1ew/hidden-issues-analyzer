import { Link, useNavigate } from 'react-router-dom';
import { useStats, useRunAnalysis } from '../lib/queries';
import { useGroupings, type RunGroup } from '../lib/grouping-queries';
import { useProductStore } from '../store/product.store';
import { ErrorState, EmptyState, LoadingState } from '../components/QueryState';
import { ScopeCounts } from '../components/ScopeCounts';
import { problemLink } from '../lib/problem-links';
import { apiErrorMessage } from '../lib/api';
import toast from 'react-hot-toast';

export function DashboardPage() {
  const { selectedProductId: productId, selectedRunId } = useProductStore();
  const stats = useStats(productId); const launch = useRunAnalysis(); const navigate = useNavigate();
  const runId = selectedRunId ?? stats.data?.scope.runId ?? '';
  const fresh = useGroupings(productId, runId, '', 1, { status: 'new', issueScope: 'product' });
  const hidden = useGroupings(productId, runId, '', 1, { hiddenOnly: true, issueScope: 'product' });
  const start = async () => { try { await launch.mutateAsync(undefined); navigate('/reviews'); } catch (error) { toast.error(apiErrorMessage(error)); } };
  if (stats.isError) return <div className="space-y-4"><h1>Обзор товара</h1><ErrorState error={stats.error} retry={stats.refetch} /></div>;
  if (stats.isPending) return <LoadingState>Загрузка обзора…</LoadingState>;
  const s = stats.data;
  if (!productId) return <div className="space-y-4"><h1>Обзор товаров</h1><EmptyState title="Выберите товар">Выберите товар в панели области, чтобы увидеть его проблемы и необходимые действия.</EmptyState><Link className="btn-primary" to="/upload">Загрузить отзывы</Link></div>;
  return <div className="space-y-6"><header><h1>Обзор товара</h1><p className="text-sm text-neutral-500 mt-1">Проблемы и действия в выбранной области анализа</p></header>
    <section className="card flex flex-wrap items-center justify-between gap-4" aria-label="Необходимые действия"><div><h2 className="text-base">Следующий шаг</h2><p className="text-sm text-neutral-500 mt-1">{!s.loadedTotal ? 'Добавьте отзывы для анализа.' : !s.hasRun ? 'У товара пока нет опубликованного результата.' : s.failedCount ? `Не удалось обработать ${s.failedCount} отзывов. Повтор доступен в истории запуска.` : !s.publicationId ? 'Группировка ещё не опубликована. Проверьте состояние запуска и повтор группировки на странице проблем.' : s.newProblemCount ? `Проверьте новые карточки проблем: ${s.newProblemCount}.` : 'Новые карточки не требуют проверки. Можно просмотреть доказательства или загрузить новые отзывы.'}</p></div>
      <div className="flex flex-wrap gap-2"><Link className="btn-outline" to="/reviews">Открыть отзывы и запуски</Link>{s.loadedTotal > 0 && <button className="btn-primary" disabled={launch.isPending} onClick={() => void start()}>Анализировать новые отзывы</button>}<Link className="btn-outline" to="/upload">Загрузить отзывы</Link></div>
    </section>
    <div className="grid xl:grid-cols-2 gap-4">
      <ProblemList title="Новые проблемы" count={s.newProblemCount} query={fresh} statsPublication={s.publicationId} productId={productId} runId={runId} />
      <ProblemList title="Жалобы в положительных отзывах" count={s.hiddenProblemCount} query={hidden} statsPublication={s.publicationId} productId={productId} runId={runId} />
    </div>
    <ScopeCounts stats={s} />
    <div className="card text-sm space-y-2"><p>Группы повторяющихся жалоб товара (все состояния): {s.problemCount ?? 'не определено'}. Отдельные сигналы: {s.signalCount ?? 'не определено'}.</p><p className="text-neutral-500">Низкая поддержка и отсутствие опубликованной группировки не доказывают отсутствие дефектов. Приоритет — порядок проверки, а не измеренная критичность.</p></div>
  </div>;
}
function ProblemList({ title, count, query, statsPublication, productId, runId }: { title: string; count: number | null;
  query: ReturnType<typeof useGroupings>; statsPublication: string | null; productId: string; runId: string }) {
  return <section className="card space-y-3"><h2 className="text-lg">{title} · {count ?? '—'}</h2>
    {query.isError ? <ErrorState error={query.error} retry={query.refetch} /> : !statsPublication ? <p className="text-sm">У области пока нет опубликованных групп. Сохранённые результаты доступны в истории запуска.</p> : query.isPending ? <p role="status">Загрузка групп…</p> : query.data.publication?.id !== statsPublication ? <p role="status">Обновление публикации…</p> : !query.data.items.length ? <p className="text-sm">В опубликованной области таких групп не найдено.</p> : <ul className="space-y-3">{query.data.items.slice(0, 3).map((group: RunGroup) => <li key={group.id} className="border-t border-neutral-200 dark:border-neutral-700 pt-3"><Link className="font-semibold underline break-words" to={problemLink({ id: group.id, productId, runId, publicationId: query.data.publication!.id })}>{group.title}</Link><p className="text-xs text-neutral-500 mt-1">Поддержка: {group.metrics.support} уникальных отзывов · Положительный контекст: {group.metrics.positiveContextCount}/{group.metrics.support} · {{ new: 'На проверке', confirmed: 'Подтверждена', rejected: 'Отклонена', resolved: 'Решена' }[group.problem?.status ?? 'new']}</p></li>)}</ul>}
    <Link className="btn-outline" to="/issues">Все проблемы выбранной области</Link>
  </section>;
}
