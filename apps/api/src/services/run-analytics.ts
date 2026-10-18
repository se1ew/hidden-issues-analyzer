/** All rates use distinct successful reviews, never mention counts. Dates are UTC. */
export interface AnalyticsInput {
  rating: number | null; reviewDate: Date | null;
  analysis: { status: string; sentiment: 'positive' | 'negative' | 'neutral' | null;
    aspects: Array<{ category: string; name: string; sentiment: 'positive' | 'negative' | 'neutral' }>;
    issues: Array<{ scope?: string }> } | null;
}
const hasComplaint = (input: AnalyticsInput) => input.analysis?.status === 'succeeded'
  && !!input.analysis.issues.some(issue => issue.scope === 'product');
export function summarizeInputs(inputs: AnalyticsInput[]) {
  const successful = inputs.filter(input => input.analysis?.status === 'succeeded');
  const rated = inputs.filter(input => input.rating !== null);
  const highRated = successful.filter(input => input.rating !== null && input.rating >= 4);
  const complaintCount = successful.filter(hasComplaint).length;
  const highRatedComplaintCount = highRated.filter(hasComplaint).length;
  const aspects = new Map<string, { category: string; name: string; reviews: number; positive: number; negative: number; neutral: number }>();
  for (const input of successful) {
    const seen = new Set<string>(), seenAspect = new Set<string>();
    for (const aspect of input.analysis!.aspects) {
      const key = JSON.stringify([aspect.category, aspect.name]);
      const row = aspects.get(key) ?? { category: aspect.category, name: aspect.name, reviews: 0, positive: 0, negative: 0, neutral: 0 };
      if (!seenAspect.has(key)) { row.reviews++; seenAspect.add(key); }
      if (!seen.has(`${key}:${aspect.sentiment}`)) { row[aspect.sentiment]++; seen.add(`${key}:${aspect.sentiment}`); }
      aspects.set(key, row);
    }
  }
  return { total: inputs.length, succeeded: successful.length, failed: inputs.filter(input => input.analysis?.status === 'failed').length,
    ratingCount: rated.length, ratingSum: rated.reduce((sum, input) => sum + input.rating!, 0),
    avgRating: rated.length ? rated.reduce((sum, input) => sum + input.rating!, 0) / rated.length : null,
    complaintCount, complaintRate: successful.length ? complaintCount / successful.length : null,
    highRatedCount: highRated.length, highRatedComplaintCount, highRatedComplaintRate: highRated.length ? highRatedComplaintCount / highRated.length : null,
    aspects: [...aspects.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)) };
}
const DAY = 86400000;
const dayStart = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const iso = (time: number) => new Date(time).toISOString();
function bucketKey(time: number, bucket: 'day' | 'week' | 'month') {
  const date = new Date(time);
  if (bucket === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  if (bucket === 'month') date.setUTCDate(1);
  return date.toISOString().slice(0, 10);
}
export function calendarAnalytics(inputs: AnalyticsInput[], run: { createdAt: Date; finishedAt: Date | null; scope: unknown }, days: number, bucket: 'day' | 'week' | 'month' = 'day') {
  const scope = run.scope as { period?: { from: string; to: string }; mode?: string; selection?: { kind: string }; limit?: number; retry?: unknown };
  // Explicit periods use their exclusive end; otherwise the stable run date anchors the window.
  const end = scope.period ? dayStart(new Date(scope.period.to)) : dayStart(run.finishedAt ?? run.createdAt);
  const start = end - days * DAY, previousStart = start - days * DAY;
  const between = (from: number, to: number) => inputs.filter(input => input.reviewDate && +input.reviewDate >= from && +input.reviewDate < to);
  const current = summarizeInputs(between(start, end)), previous = summarizeInputs(between(previousStart, start));
  const inScope = !scope.period || (+new Date(scope.period.from) <= previousStart && +new Date(scope.period.to) >= end);
  const reasons: string[] = [];
  if (end > dayStart(run.finishedAt ?? run.createdAt)) reasons.push('Текущий календарный период ещё не завершился к моменту запуска.');
  if (scope.period && (dayStart(new Date(scope.period.from)) !== +new Date(scope.period.from) || dayStart(new Date(scope.period.to)) !== +new Date(scope.period.to))) reasons.push('Границы области не совпадают с полными UTC днями; график заканчивается последней полной границей дня.');
  if (!inScope) reasons.push('Предыдущий период выходит за область запуска.');
  if (scope.mode !== 'reanalyze' || scope.selection?.kind !== 'all_reviews' || scope.retry || (scope.limit !== undefined && inputs.length >= scope.limit)) reasons.push('Область запуска может содержать только часть отзывов товара.');
  if (current.succeeded < 5 || previous.succeeded < 5) reasons.push('Для сравнения нужно хотя бы 5 успешно обработанных отзывов в каждом периоде.');
  if (current.succeeded !== current.total || previous.succeeded !== previous.total) reasons.push('Не все отзывы сравниваемых периодов обработаны успешно.');
  const unknownDateCount = inputs.filter(input => !input.reviewDate).length;
  if (unknownDateCount) reasons.push('Есть отзывы без даты; их нельзя отнести к календарным периодам.');
  const comparable = !reasons.length;
  const change = (now: number | null, before: number | null, higherBetter: boolean) => {
    if (!comparable || now === null || before === null) return { delta: null, meaning: 'unknown' as const };
    const delta = now - before;
    return { delta, meaning: delta === 0 ? 'unchanged' as const : (delta > 0) === higherBetter ? 'improvement' as const : 'worsening' as const };
  };
  const rows = new Map<string, { date: string; from: string; to: string; inputs: AnalyticsInput[] }>();
  // Seed every day first, so empty days/weeks/months are retained.
  for (let date = start; date < end; date += DAY) {
    const key = bucketKey(date, bucket), row = rows.get(key) ?? { date: key, from: iso(date), to: iso(date + DAY), inputs: [] };
    row.to = iso(date + DAY); rows.set(key, row);
  }
  for (const input of between(start, end)) rows.get(bucketKey(dayStart(input.reviewDate!), bucket))!.inputs.push(input);
  const buckets = [...rows.values()].map(({ inputs: values, ...row }) => {
    const summary = summarizeInputs(values), sentiment = { positive: 0, negative: 0, neutral: 0 };
    for (const input of values) if (input.analysis?.status === 'succeeded' && input.analysis.sentiment) sentiment[input.analysis.sentiment]++;
    return { ...row, ...sentiment, ...summary, aspects: undefined };
  });
  return { hasRun: true, timezone: 'UTC', unknownDateCount, unknownDateSucceeded: inputs.filter(input => !input.reviewDate && input.analysis?.status === 'succeeded').length,
    buckets, comparison: { current: { from: iso(start), to: iso(end), ...current }, previous: { from: iso(previousStart), to: iso(start), ...previous },
      comparable, reasons, complaintRate: change(current.complaintRate, previous.complaintRate, false),
      avgRating: current.ratingCount < 5 || previous.ratingCount < 5 ? { delta: null, meaning: 'unknown' as const } : change(current.avgRating, previous.avgRating, true) },
    limitation: 'Показатели описывают сохранённую выборку и извлечение модели. Изменение не доказывает изменение качества товара; статистическая значимость не оценивалась.' };
}
