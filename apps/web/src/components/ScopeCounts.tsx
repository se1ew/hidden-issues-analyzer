import type { OverviewStats } from '../lib/queries';
export function ScopeCounts({ stats }: { stats: OverviewStats }) {
  const rows = [['Загружено в товар', stats.loadedTotal], ['В области запуска', stats.scopeTotal],
    ['Успешно обработано', stats.hasRun ? stats.succeededCount : null], ['Ошибки обработки', stats.hasRun ? stats.failedCount : null]] as const;
  return <section aria-label="Объём данных" className="space-y-3"><div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">{rows.map(([label, value]) => <div className="card" key={label}><p className="text-xs text-neutral-500">{label}</p><p className="text-2xl font-semibold mt-1">{value ?? '—'}</p></div>)}</div>
    <p className="text-sm text-neutral-500">{stats.hasRun ? `Покрытие: ${stats.succeededCount}/${stats.scopeTotal}; осталось: ${stats.remainingCount}. Распространённость жалоб считается среди успешно обработанных отзывов.` : 'Выберите запуск или выполните анализ. Отсутствие результата не означает отсутствие проблем.'}</p></section>;
}
