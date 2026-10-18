import { Link } from 'react-router-dom';
import type { ReviewListItem } from '../lib/queries';
import { evidenceSegments } from '../lib/evidence';
import { problemLink } from '../lib/problem-links';
import { analysisStatusNames, runErrorHint } from '../lib/run-labels';

export const sourceNames: Record<string, string> = { csv: 'CSV', manual: 'Ручной ввод', wildberries: 'Wildberries', parsing: 'Wildberries', legacy: 'Старый импорт' };
export function ReviewDetails({ review }: { review: ReviewListItem }) {
  const evidence = review.evidence ?? [];
  const hint = runErrorHint(review.errorCode);
  return <div className="space-y-4 text-sm">
    <dl className="grid sm:grid-cols-2 gap-3"><div><dt className="text-neutral-500">Оценка</dt><dd>{review.rating ?? 'Не указана'}</dd></div>
      <div><dt className="text-neutral-500">Источник</dt><dd>{sourceNames[review.source ?? ''] ?? review.source ?? 'Не указан'}{review.externalId ? ` · ID: ${review.externalId}` : ''}</dd></div>
      <div><dt className="text-neutral-500">Дата отзыва</dt><dd>{review.reviewDate ? new Date(review.reviewDate).toLocaleString('ru-RU') : 'Не указана'}</dd></div>
      <div><dt className="text-neutral-500">Импортирован</dt><dd>{new Date(review.importedAt ?? review.createdAt).toLocaleString('ru-RU')}</dd></div></dl>
    <p>Статус анализа: {review.analysisStatus ? analysisStatusNames[review.analysisStatus] : 'Выберите сохранённый запуск для проверяемых результатов'}</p>
    {hint && <p role="alert">{hint}</p>}
    <section aria-label="Исходный текст отзыва"><h3 className="text-sm mb-2">Исходный текст</h3><p className="whitespace-pre-wrap break-words">{evidenceSegments(review.text, evidence, 'utf16').map((part, index) => part.highlighted ? <mark className="bg-amber-200 text-neutral-900" key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</p></section>
    {!!review.aspects?.length && <section><h3 className="text-sm mb-2">Аспекты</h3><div className="flex flex-wrap gap-2">{review.aspects.map((aspect, index) => <span key={index} className={aspect.sentiment === 'negative' ? 'badge-negative' : aspect.sentiment === 'positive' ? 'badge-positive' : 'badge-neutral'}>{aspect.name} · {aspect.sentiment === 'negative' ? 'отрицательно' : aspect.sentiment === 'positive' ? 'положительно' : 'нейтрально'}</span>)}</div></section>}
    {evidence.map(issue => <section className="border-t border-neutral-200 dark:border-neutral-700 pt-3 space-y-2" key={issue.id}><h3 className="text-base">{issue.defect}</h3><blockquote className="whitespace-pre-wrap break-words">«{issue.quote}»</blockquote>
      <p>Последствия: {issue.consequences ?? 'Не определены'}</p>
      {issue.groupLinks?.map(group => <Link key={group.id} className="underline block" to={problemLink(group)}>Открыть группу: {group.title}</Link>)}
      {!issue.groupLinks?.length && <p className="text-neutral-500">Жалоба ещё не включена в опубликованную группу этого запуска.</p>}
    </section>)}
    {review.analysisStatus === 'succeeded' && !evidence.length && <p>Жалобы с проверяемой цитатой не найдены.</p>}
    {!review.analysisStatus && !!review.issues?.length && <p className="text-neutral-500">В старых данных есть жалобы без доказательств. Выберите запуск или выполните новый анализ.</p>}
  </div>;
}
