import type { ReportSnapshot } from './report-snapshot.js';
export interface ReportBlock { heading?: boolean; text: string }
const value = (input: number | null) => input === null ? 'не определено' : String(input);
const percent = (input: number | null) => input === null ? 'не определено' : `${(input * 100).toFixed(1)}%`;
export function reportBlocks(snapshot: ReportSnapshot): ReportBlock[] {
  const { overview: s, analytics: a, run } = snapshot;
  const blocks: ReportBlock[] = [];
  const line = (text: string) => blocks.push({ text });
  const heading = (text: string) => blocks.push({ heading: true, text });
  line(`Товар: ${snapshot.product.name} (${snapshot.product.id}). Запуск: ${run.id}.`);
  line(`Период области: ${snapshot.scope.period ? `${snapshot.scope.period.from} - ${snapshot.scope.period.to} (конец не включён)` : 'без ограничения по дате'}. Публикация: ${snapshot.publicationId ?? 'нет'}.`);
  line(`Сформирован: ${snapshot.generatedAt}. Все числа и решения зафиксированы на этот момент.`);
  line(`AI извлечение: ${run.provider} / ${run.model}. Выводы модели требуют проверки и не устанавливают причину дефекта.`);
  if (snapshot.sections.includes('overview')) {
    heading('Объём и покрытие');
    line(`Загружено в товар: ${s.loadedTotal}. В области запуска: ${s.scopeTotal}. Успешно: ${s.succeededCount}. Ошибки: ${s.failedCount}. Осталось: ${s.remainingCount}.`);
    line(`Покрытие: ${s.succeededCount}/${s.scopeTotal}. Группы проблем товара во всех состояниях: ${value(s.problemCount)}. В положительном контексте: ${value(s.hiddenProblemCount)}.`);
    for (const error of snapshot.errors) line(`Ошибка отзыва ${error.reviewId}: ${error.code ?? 'неизвестная'}.`);
  }
  if (snapshot.sections.includes('analytics')) {
    heading('Показатели выборки');
    line(`Средняя оценка: ${a.avgRating?.toFixed(2) ?? 'не определено'}; известных оценок: ${a.ratingCount}, сумма: ${a.ratingSum}.`);
    line(`Отзывы с жалобами на товар: ${a.complaintCount}/${a.succeeded} (${percent(a.complaintRate)}). Один отзыв считается один раз.`);
    line(`Жалобы среди успешно обработанных оценок 4 и 5: ${a.highRatedComplaintCount}/${a.highRatedCount} (${percent(a.highRatedComplaintRate)}).`);
    const c = snapshot.calendar.comparison;
    for (const [name, period] of [['Текущий', c.current], ['Предыдущий', c.previous]] as const) line(`${name} период UTC ${period.from} - ${period.to}: обработано ${period.succeeded}/${period.total}, жалобы ${period.complaintCount}/${period.succeeded} (${percent(period.complaintRate)}), средняя оценка ${period.avgRating?.toFixed(2) ?? 'не определено'} (${period.ratingCount} оценок).`);
    line(`Отзывы без даты: ${snapshot.calendar.unknownDateCount}.`);
    if (!c.comparable) line(`Сравнение ограничено: ${c.reasons.join(' ')}`);
    else line(`Изменение доли жалоб: ${((c.complaintRate.delta ?? 0) * 100).toFixed(1)} процентных пункта. Рост означает ухудшение.`);
    line(snapshot.calendar.limitation);
  }
  if (snapshot.sections.includes('aspects')) {
    heading('Аспекты и тональность');
    if (!a.aspects.length) line('Извлечённых аспектов нет.');
    for (const aspect of a.aspects) line(`${aspect.category} / ${aspect.name}: ${aspect.reviews}/${a.succeeded} отзывов; положительная ${aspect.positive}, отрицательная ${aspect.negative}, нейтральная ${aspect.neutral}.`);
    line('Один отзыв может иметь несколько аспектов и несколько тональностей одного аспекта; столбцы не складываются в число отзывов.');
  }
  if (snapshot.sections.includes('problems') || snapshot.sections.includes('evidence')) {
    heading('Группы жалоб и доказательства');
    if (!snapshot.publicationId) line('Группировка не опубликована; число проблем неизвестно.');
    else if (!snapshot.groups.length) line('В опубликованной области групп нет.');
    const states: Record<string, string> = { new: 'На проверке', confirmed: 'Подтверждена', rejected: 'Отклонена', resolved: 'Решена' };
    for (const group of snapshot.groups) {
      heading(group.title);
      line(`Группа ${group.id}; аспект ${group.category}; область ${group.scope}. Поддержка ${group.reviewCount}/${s.succeededCount}; положительный контекст ${group.positiveContextCount}/${group.reviewCount}. Статус: ${group.problem ? states[group.problem.status] ?? group.problem.status : 'отдельный сигнал'}; версия решения ${group.problem?.stateVersion ?? 'нет'}.`);
      const metrics = (group.metrics ?? {}) as { prevalence?: number | null; masking?: number | null; priority?: { explanation?: string; limitation?: string } };
      line(`Распространённость: ${percent(metrics.prevalence ?? null)}. Положительный контекст среди поддержки: ${percent(group.reviewCount ? group.positiveContextCount / group.reviewCount : null)}.`);
      if (metrics.priority?.explanation) line(metrics.priority.explanation);
      if (metrics.priority?.limitation) line(metrics.priority.limitation);
      if (snapshot.sections.includes('evidence')) for (const evidence of group.evidence) {
        line(`Отзыв ${evidence.reviewId}, источник ${evidence.source}, оценка ${evidence.rating ?? 'неизвестна'}, дата ${evidence.reviewDate ?? 'неизвестна'}.`);
        line(`Цитата: «${evidence.quote}» (UTF-16 ${evidence.quoteStart}..${evidence.quoteEnd}, конец исключён).`);
        if (evidence.consequences) line(`Последствие со слов автора: ${evidence.consequences}`);
      }
    }
  }
  heading('Метод и ограничения');
  line(`Модель: ${run.model}; версия: ${run.modelVersion}. Метод: ${run.methodVersion}; промпт: ${run.promptVersion}; эмбеддинги: ${run.embeddingVersion}. Статус запуска: ${run.status}.`);
  for (const limitation of run.limitations) line(limitation);
  return blocks;
}
