import { useState } from 'react';
import { useAnalysisInputs } from '../lib/queries';
import { evidenceSegments } from '../lib/evidence';

const statuses: Record<string, string> = { pending: 'Ожидает обработки', running: 'Обрабатывается', succeeded: 'Обработан', failed: 'Ошибка обработки' };
const sentiments: Record<string, string> = { positive: 'положительная', negative: 'отрицательная', neutral: 'нейтральная' };

export function AnalysisRunResults({ runId }: { runId: string }) {
  const [page, setPage] = useState(1);
  const results = useAnalysisInputs(runId, page);
  if (results.isPending) return <p role="status">Загрузка результатов…</p>;
  if (results.isError) return <div role="alert">Не удалось загрузить результаты. <button className="btn-soft" onClick={() => void results.refetch()}>Повторить</button></div>;
  const { items, total, pageSize, offsetUnit } = results.data;
  return <div className="space-y-3" aria-label="Результаты запуска">
    {!items.length && <p>В запуске нет отзывов.</p>}
    {items.map((input) => <article key={input.id} className="border-t border-neutral-200 dark:border-neutral-700 pt-3 space-y-2 text-sm">
      <p>Оценка: {input.rating ?? 'не указана'} · {statuses[input.analysis?.status ?? 'pending']}</p>
      <p className="text-xs text-neutral-500">Источник: {input.source ?? 'не указан'} · Дата отзыва: {input.reviewDate ? new Date(input.reviewDate).toLocaleString('ru-RU') : 'не указана'}</p>
      <p className="whitespace-pre-wrap break-words">{evidenceSegments(input.text, input.analysis?.issues ?? [], offsetUnit).map((segment, index) => segment.highlighted
        ? <mark key={index} className="bg-amber-200 text-neutral-900">{segment.text}</mark> : <span key={index}>{segment.text}</span>)}</p>
      {input.analysis?.errorCode === 'invalid_evidence' && <p role="alert" className="text-amber-700 dark:text-amber-300">Модель вернула неподтверждённую цитату или последствия. Результат не принят; отзыв можно обработать повторно.</p>}
      {!!input.analysis?.aspects.length && <p>Аспекты: {input.analysis.aspects.map((aspect) => `${aspect.name} (${sentiments[aspect.sentiment]})`).join('; ')}</p>}
      {input.analysis?.issues.map((issue) => <div key={issue.id} className="rounded-lg bg-neutral-50 dark:bg-neutral-800 p-2 space-y-1">
        <p className="font-medium">{issue.defect}</p>
        <blockquote className="whitespace-pre-wrap break-words">«{issue.quote}»</blockquote>
        <p>Последствия: {issue.consequences ?? 'не определены'}</p>
        <p>{issue.masking?.positiveContext ? `Жалоба в положительном контексте: ${issue.masking.reasons.map((reason) => reason === 'high_rating' ? 'оценка 4–5' : 'положительная общая тональность').join(', ')}` : 'Положительный контекст не установлен'}</p>
      </div>)}
      {input.analysis?.status === 'succeeded' && !input.analysis.issues.length && <p className="text-neutral-500">Подтверждённые цитатой жалобы не извлечены.</p>}
    </article>)}
    {total > pageSize && <div className="flex items-center gap-3">
      <button className="btn-soft" disabled={page === 1} onClick={() => setPage(page - 1)}>Предыдущие отзывы</button>
      <span>{page} / {Math.ceil(total / pageSize)}</span>
      <button className="btn-soft" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>Следующие отзывы</button>
    </div>}
  </div>;
}
