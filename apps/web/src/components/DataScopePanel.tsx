import { useState } from 'react';
import { useAnalysisRun, useAnalysisRuns, useProducts, useRunAnalysis } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import { ProductSelector } from './ProductSelector';
import { ErrorState } from './QueryState';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiErrorMessage } from '../lib/api';
import toast from 'react-hot-toast';

export const runStatusNames: Record<string, string> = { queued: 'В очереди', running: 'В работе', completed: 'Завершён', partial: 'Частично', cancelled: 'Отменён', failed: 'Ошибка', interrupted: 'Прерван' };
const dateText = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : 'не указано';
export function DataScopePanel() {
  const { selectedProductId, selectedRunId, from, to, setDataScope } = useProductStore();
  const products = useProducts(); const runs = useAnalysisRuns(selectedProductId);
  const detail = useAnalysisRun(selectedRunId); const launch = useRunAnalysis(); const navigate = useNavigate();
  const location = useLocation();
  const clearProblemLink = () => { if (location.pathname === '/issues' && location.search) navigate('/issues', { replace: true }); };
  const [periodError, setPeriodError] = useState('');
  const [draftFrom, setDraftFrom] = useState(''), [draftTo, setDraftTo] = useState('');
  const run = detail.data;
  const displayFrom = run?.scope?.period?.from ?? from, displayTo = run?.scope?.period?.to ?? to;
  const product = products.data?.items.find(item => item.id === selectedProductId);
  const apply = () => {
    const a = Date.parse(draftFrom), b = Date.parse(draftTo);
    if ((!draftFrom && draftTo) || (draftFrom && !draftTo) || (draftFrom && (!Number.isFinite(a) || !Number.isFinite(b) || a >= b))) {
      setPeriodError('Укажите обе границы; начало должно быть раньше конца.'); return;
    }
    setPeriodError(''); setDataScope({ from: draftFrom ? new Date(a).toISOString() : null, to: draftTo ? new Date(b).toISOString() : null });
  };
  return <section aria-label="Область данных" className="scope-panel mb-6">
    <div className="flex flex-wrap items-end gap-4"><div className="flex-1 min-w-full sm:min-w-0"><ProductSelector compact onSelectionChange={clearProblemLink} /></div>
      <label className="text-sm flex-1 min-w-full sm:min-w-0">Запуск анализа<select className="input mt-1" disabled={!selectedProductId || runs.isLoading} value={selectedRunId ?? ''} onChange={event => {
        clearProblemLink();
        const selected = runs.data?.items.find(item => item.id === event.target.value);
        setDataScope({ runId: event.target.value || null, from: selected?.scope?.period?.from ?? null, to: selected?.scope?.period?.to ?? null });
      }}><option value="">Все загруженные отзывы / текущие группы</option>
        {selectedRunId && !runs.data?.items.some(item => item.id === selectedRunId) && <option value={selectedRunId}>Выбранный запуск</option>}
        {runs.data?.items.map(item => <option key={item.id} value={item.id}>{dateText(item.createdAt)} · {runStatusNames[item.status]} · {item.succeeded}/{item.total}</option>)}</select></label>
    </div>
    {products.isError && <ErrorState error={products.error} retry={products.refetch} />}
    {runs.isError && <ErrorState error={runs.error} retry={runs.refetch} />}
    {detail.isError && selectedRunId && <ErrorState error={detail.error} retry={detail.refetch} />}
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-live="polite"><span className="break-words min-w-0">Товар: <strong>{product?.name ?? 'Все товары'}</strong></span>
      <span>Период отзывов: {displayFrom && displayTo ? `${dateText(displayFrom)} — ${dateText(displayTo)} (конец не включён)` : 'Без ограничения по дате'}</span>
      {selectedRunId && !run && !detail.isError && <span role="status">Загрузка области запуска…</span>}
      {run && <><span>{runStatusNames[run.status]} · Покрытие: {run.succeeded}/{run.total} · Ошибки: {run.failed} · Осталось: {run.remaining}</span><span>Время анализа: {dateText(run.finishedAt ?? run.startedAt)}</span></>}
      {!selectedRunId && <span>Покрытие запуска: выберите запуск для точных показателей</span>}
    </div>
    {!selectedRunId && selectedProductId && <details><summary className="text-sm cursor-pointer">Выбрать период отзывов</summary>
      <div className="flex flex-wrap items-end gap-3 mt-3"><label className="text-sm">С (местное время)<input type="datetime-local" className="input mt-1" value={draftFrom} onChange={event => setDraftFrom(event.target.value)} /></label>
        <label className="text-sm">До, не включая<input type="datetime-local" className="input mt-1" value={draftTo} onChange={event => setDraftTo(event.target.value)} /></label>
        <button className="btn-outline" onClick={apply}>Применить период</button>
        {from && to && <button className="btn-primary" disabled={launch.isPending} onClick={async () => { try { await launch.mutateAsync(undefined); navigate('/reviews'); } catch (error) { toast.error(apiErrorMessage(error)); } }}>Анализировать этот период</button>}
      </div>{periodError && <p role="alert" className="text-sm mt-2">{periodError}</p>}
      <p className="text-xs text-neutral-500 mt-2">Группы относятся к сохранённой области запуска. Для другого периода создайте новый анализ.</p>
    </details>}
  </section>;
}
