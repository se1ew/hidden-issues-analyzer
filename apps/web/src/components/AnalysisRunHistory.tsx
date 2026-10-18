import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAnalysisRuns, useCancelAnalysis, useRetryFailedAnalysis, useProducts, type AnalysisRunItem } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import { AnalysisRunResults } from './AnalysisRunResults';
import { stageNames, runErrorHint } from '../lib/run-labels';

const statusNames: Record<AnalysisRunItem['status'], string> = {
  queued: 'В очереди', running: 'Обрабатывается', completed: 'Завершён', partial: 'Частично',
  failed: 'С ошибками', cancelled: 'Отменён', interrupted: 'Прерван',
};

export function AnalysisRunHistory() {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [page, setPage] = useState(1); const [now, setNow] = useState(Date.now());
  const productId = useProductStore((state) => state.selectedProductId);
  const history = useAnalysisRuns(productId, page);
  useEffect(() => { setPage(1); setExpandedRunId(null); }, [productId]);
  const active = history.data?.items.some(run => ['queued', 'running'].includes(run.status));
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  const products = useProducts();
  const cancel = useCancelAnalysis();
  const retry = useRetryFailedAnalysis();

  return <div className="card space-y-4">
    <h2 className="text-base font-semibold">Запуски анализа</h2>
    {history.isLoading && <p className="text-sm text-neutral-500">Загрузка истории…</p>}
    {history.isError && <p role="alert" className="text-sm text-red-700">Не удалось получить состояние. Запущенный анализ продолжает работать на сервере.</p>}
    {!history.isLoading && !history.isError && !history.data?.items.length && <p className="text-sm text-neutral-500">Для выбранного товара ещё нет запусков.</p>}
    <div className="space-y-3">{history.data?.items.map((run) => {
      const active = ['queued', 'running'].includes(run.status);
      const name = products.data?.items.find((product) => product.id === run.productId)?.name ?? 'Товар';
      const elapsed = run.startedAt ? Math.max(0, Math.floor(((run.finishedAt ? Date.parse(run.finishedAt) : now) - Date.parse(run.startedAt)) / 1000)) : null;
      const hint = runErrorHint(run.finishReason);
      return <div key={run.id} className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-3 space-y-2">
        <div className="flex flex-wrap justify-between gap-2">
          <div><p className="font-semibold text-sm">{name}</p>
            <p className="text-xs text-neutral-500">{new Date(run.createdAt).toLocaleString('ru-RU')} · {run.provider === 'local' ? 'Локально' : 'OpenRouter'} · {run.model}</p>
          </div>
          <span className="text-sm font-medium">{run.cancelRequestedAt && active ? 'Останавливается' : statusNames[run.status]}</span>
        </div>
        <p className="text-sm">Успешно: {run.succeeded} · Ошибки: {run.failed} · Осталось: {run.remaining} · Всего: {run.total}</p>
        <p className="text-sm">Этап: {stageNames[run.stage] ?? run.stage} · Длительность: {elapsed === null ? 'ещё не начат' : `${Math.floor(elapsed / 60)} мин ${elapsed % 60} с`}</p>
        <progress aria-label="Обработано отзывов" className="w-full h-2" value={run.processed} max={Math.max(1, run.total)} />
        {hint && <p className="text-sm">{hint}</p>}
        <details className="text-xs space-y-2"><summary>Модель, версии и ограничения</summary><p>{run.provider === 'local' ? 'Локальный провайдер' : 'OpenRouter'} · {run.model} · Версия модели: {run.modelVersion === 'unverified' ? 'не проверена' : run.modelVersion ?? 'не указана'}</p>
          <p>Промпт: {run.promptVersion ?? 'не указан'} · Метод: {run.methodVersion ?? 'не указан'} · Эмбеддинги: {run.embeddingVersion ?? 'не указаны'}</p>
          {(run.limitations ?? ['Качество модели и вероятность ошибок не измерены.']).map(text => <p key={text}>{text}</p>)}
        </details>
        <button className="btn-soft" aria-expanded={expandedRunId === run.id} onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}>{expandedRunId === run.id ? 'Скрыть результаты' : 'Показать результаты'}</button>
        {expandedRunId === run.id && <AnalysisRunResults key={run.id} runId={run.id} />}
        {run.previousRunId && <p className="text-xs text-neutral-500">Повтор ошибок запуска {run.previousRunId}</p>}
        {['cancelled', 'interrupted'].includes(run.status) && <p className="text-sm text-amber-700 dark:text-amber-300">Сохранённые результаты остаются в этом запуске и не заменяют последний опубликованный результат.</p>}
        {!active && run.failed > 0 && <button className="btn-soft" disabled={retry.isPending || history.data?.items.some((item) => item.productId === run.productId && ['queued', 'running'].includes(item.status))} onClick={async () => {
          try { await retry.mutateAsync(run.id); }
          catch { toast.error('Не удалось повторить ошибки. Проверьте наличие активного запуска.'); }
        }}>Повторить ошибки ({run.failed})</button>}
        {run.finishReason === 'grouping_pending' && <p className="text-sm text-amber-700 dark:text-amber-300">Извлечение сохранено. Группы проблем для этого запуска пока недоступны.</p>}
        {active && <button className="btn-soft" disabled={cancel.isPending || !!run.cancelRequestedAt} onClick={async () => {
          try { await cancel.mutateAsync(run.id); }
          catch { toast.error('Не удалось отправить отмену. Проверьте состояние и повторите.'); }
        }}>Остановить</button>}
      </div>;
    })}</div>
    {!!history.data && history.data.total > 20 && <div className="flex gap-3 items-center"><button className="btn-outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Раньше</button><span>{page} / {Math.ceil(history.data.total / 20)}</span><button className="btn-outline" disabled={page * 20 >= history.data.total} onClick={() => setPage(page + 1)}>Далее</button></div>}
  </div>;
}
