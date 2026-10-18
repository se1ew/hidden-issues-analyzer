import type { AnalyticsSummary, CalendarResult, MetricChange } from '../lib/queries';
export const percent = (value: number | null) => value === null ? 'не определено' : `${(value * 100).toFixed(1)}%`;
export function Change({ change, rate = false }: { change: MetricChange; rate?: boolean }) {
  const labels = { unknown: 'Недостаточно данных', unchanged: 'Без изменения', improvement: 'Улучшение', worsening: 'Ухудшение' };
  return <span className={change.meaning === 'worsening' ? 'text-red-700 dark:text-red-300' : change.meaning === 'improvement' ? 'text-green-700 dark:text-green-300' : 'text-neutral-500'}>
    {labels[change.meaning]}{change.delta !== null ? `: ${change.delta > 0 ? '+' : ''}${(change.delta * (rate ? 100 : 1)).toFixed(2)}${rate ? ' п.п.' : ''}` : ''}</span>;
}
export function RunAnalytics({ summary }: { summary: AnalyticsSummary }) {
  return <>
    <section className="card space-y-2"><h2 className="text-lg">Жалобы на товар в выборке</h2>
      <p>Среди успешно обработанных: {summary.complaintCount}/{summary.succeeded} · {percent(summary.complaintRate)}</p>
      <p>Среди успешно обработанных с оценкой 4–5: {summary.highRatedComplaintCount}/{summary.highRatedCount} · {percent(summary.highRatedComplaintRate)}</p>
      <p className="text-xs text-neutral-500">Один отзыв учитывается один раз независимо от числа жалоб. Жалобы на доставку, продавца и упаковку исключены. Неизвестные рейтинги не входят в знаменатель оценок 4–5. Малая выборка ограничивает выводы; это результат извлечения модели.</p>
    </section>
    <section className="card space-y-3"><h2 className="text-lg">Аспекты и тональность</h2>
      <p className="text-xs text-neutral-500">Поддержка — уникальные отзывы / {summary.succeeded} успешных результатов. Один отзыв может иметь несколько аспектов и тональностей; столбцы тональности не складываются в число отзывов.</p>
      {!summary.aspects.length ? <p>Извлечённых аспектов нет.</p> : <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Таблица аспектов с горизонтальной прокруткой"><table className="w-full min-w-[42rem] text-sm"><thead><tr><th className="text-left p-3 min-w-48">Аспект</th><th className="p-3">Поддержка</th><th className="p-3">Положительная</th><th className="p-3">Отрицательная</th><th className="p-3">Нейтральная</th></tr></thead><tbody>{summary.aspects.map(aspect => <tr className="border-t border-neutral-200 dark:border-neutral-700" key={JSON.stringify([aspect.category, aspect.name])}><td className="p-2 break-words">{aspect.name}<span className="block text-xs text-neutral-500">{aspect.category}</span></td><td className="p-2">{aspect.reviews}/{summary.succeeded}</td><td className="p-2">{aspect.positive}</td><td className="p-2">{aspect.negative}</td><td className="p-2">{aspect.neutral}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
export function CalendarComparison({ calendar }: { calendar: CalendarResult }) {
  const comparison = calendar.comparison;
  if (!comparison) return null;
  return <section className="card space-y-3"><h2 className="text-lg">Равные календарные периоды UTC</h2>
    <p className="text-xs text-neutral-500">Границы: начало включено, конец исключён. Пустые дни сохранены. Окно заканчивается границей периода запуска или началом UTC дня его завершения.</p>
    <div className="grid md:grid-cols-2 gap-4">{([['Текущий', comparison.current], ['Предыдущий', comparison.previous]] as const).map(([name, period]) => <div key={name}><h3 className="font-semibold">{name}</h3><p className="text-xs break-words">{period.from} — {period.to}</p><p className="text-sm mt-2">Обработано {period.succeeded}/{period.total}; жалобы {period.complaintCount}/{period.succeeded} · {percent(period.complaintRate)}</p><p className="text-sm">Средняя оценка {period.avgRating?.toFixed(2) ?? '—'} · {period.ratingCount} известных оценок</p></div>)}</div>
    <p>Доля жалоб: <Change change={comparison.complaintRate} rate /></p><p>Средняя оценка: <Change change={comparison.avgRating} /></p>
    {!comparison.comparable && <ul className="text-sm list-disc pl-5">{comparison.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    <p className="text-xs text-neutral-500">{calendar.limitation} Для числового сравнения оценок нужно минимум 5 известных рейтингов в каждом периоде.</p>
  </section>;
}
