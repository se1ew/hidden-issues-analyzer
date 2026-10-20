export const analysisStatusNames: Record<string, string> = { pending: 'Ожидает обработки', running: 'Обрабатывается', succeeded: 'Обработан', failed: 'Ошибка обработки' };
export const stageNames: Record<string, string> = { selection: 'Подбор отзывов', extraction: 'Извлечение аспектов и жалоб', grouping: 'Группировка', persistence: 'Сохранение результата', queued: 'В очереди' };
export function runErrorHint(code?: string | null) {
  if (code === 'invalid_evidence') return 'Цитата или последствия не подтверждены исходным текстом. Повторите ошибки запуска.';
  if (code?.includes('grouping')) return 'Извлечение сохранено, но группировка недоступна. Проверьте модель эмбеддингов и повторите группировку.';
  if (code === 'resource_exhausted') return 'Модели не хватает памяти. Уменьшите контекст или выберите меньшую модель, затем повторите ошибочные отзывы.';
  if (code === 'input_too_long') return 'Текст не помещается в контекст модели. Увеличьте доступный контекст или выберите подходящую модель.';
  if (code === 'model_not_found' || code === 'unavailable') return 'Запустите настроенную модель и проверьте её имя в настройках сервера, затем повторите ошибки.';
  if (code === 'timeout') return 'Модель не ответила вовремя. Проверьте её доступность и повторите ошибки.';
  if (code === 'lease_expired' || code === 'worker_shutdown') return 'Worker остановился. Запустите его и выполните новый анализ выбранной области; сохранённая часть предыдущего запуска остаётся доступной.';
  if (code === 'owner_cancelled') return 'Запуск отменён владельцем. Сохранённая часть доступна отдельно от опубликованного результата.';
  if (!code || ['analysis_completed', 'extraction_without_complaints', 'empty_selection'].includes(code)) return null;
  return 'Обработка завершилась не полностью. Проверьте доступность модели и повторите ошибочные отзывы; сохранённые результаты доступны.';
}
