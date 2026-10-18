import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';
import type { DataScope } from '../schemas/data-scope.schema.js';
import { assertRunPeriod } from './data-scope.js';

export async function readRunData(userId: string, query: DataScope) {
  const run = await prisma.analysisRun.findFirst({ where: { id: query.runId, productId: query.productId, userId, product: { userId } } });
  if (!run || !query.runId || !query.productId) throw new HttpError(404, 'Запуск выбранного товара не найден');
  assertRunPeriod(run.scope, query);
  const inputs = await prisma.analysisRunReview.findMany({ where: { runId: run.id }, orderBy: { id: 'asc' },
    include: { analysis: { include: { aspects: true, issues: true } } } });
  const publication = await prisma.groupingPublication.findFirst({ where: { runId: run.id, sealedAt: { not: null } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, _count: { select: { snapshots: true } } } });
  const successful = inputs.filter(item => item.analysis?.status === 'succeeded');
  const sentiment = { positive: 0, negative: 0, neutral: 0 };
  const aspects = new Map<string, { category: string; name: string; positive: number; negative: number; neutral: number }>();
  for (const item of successful) {
    if (item.analysis?.sentiment) sentiment[item.analysis.sentiment]++;
    // Count an aspect/sentiment once per review, even if extraction repeats it.
    const seen = new Set<string>();
    for (const aspect of item.analysis?.aspects ?? []) {
      const key = JSON.stringify([aspect.category, aspect.name]);
      if (seen.has(`${key}:${aspect.sentiment}`)) continue;
      seen.add(`${key}:${aspect.sentiment}`);
      const row = aspects.get(key) ?? { category: aspect.category, name: aspect.name, positive: 0, negative: 0, neutral: 0 };
      row[aspect.sentiment]++; aspects.set(key, row);
    }
  }
  const ratings = inputs.flatMap(item => item.rating === null ? [] : [item.rating]);
  const sentimentTotal = Object.values(sentiment).reduce((a, b) => a + b, 0);
  return { run, inputs, publication,
    scope: { productId: run.productId, runId: run.id, period: (run.scope as { period?: unknown }).period ?? null },
    overview: { total: inputs.length, analyzed: successful.length, pending: inputs.length - successful.length,
      failed: inputs.filter(item => item.analysis?.status === 'failed').length,
      avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      sentiment, negativePct: sentimentTotal ? 100 * sentiment.negative / sentimentTotal : 0,
      issuesCount: publication?._count.snapshots ?? 0, publicationId: publication?.id ?? null },
    aspects: [...aspects.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)) };
}

export function runTimeseries(data: Awaited<ReturnType<typeof readRunData>>, bucket: 'day' | 'week' | 'month', days: number) {
  const map = new Map<string, { date: string; positive: number; negative: number; neutral: number; ratingSum: number; ratingCount: number }>();
  const since = data.run.finishedAt ?? data.run.createdAt;
  const lower = new Date(since.getTime() - days * 86400000);
  let unknownDateCount = 0;
  for (const input of data.inputs) {
    if (!input.reviewDate) { unknownDateCount++; continue; }
    if (input.reviewDate < lower) continue;
    const date = new Date(input.reviewDate);
    date.setUTCHours(0, 0, 0, 0);
    if (bucket === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    if (bucket === 'month') date.setUTCDate(1);
    const key = date.toISOString().slice(0, 10);
    const row = map.get(key) ?? { date: key, positive: 0, negative: 0, neutral: 0, ratingSum: 0, ratingCount: 0 };
    if (input.analysis?.status === 'succeeded' && input.analysis.sentiment) row[input.analysis.sentiment]++;
    if (input.rating !== null) { row.ratingSum += input.rating; row.ratingCount++; }
    map.set(key, row);
  }
  return { scope: data.scope, unknownDateCount, buckets: [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
    .map(({ ratingSum, ratingCount, ...row }) => ({ ...row, avgRating: ratingCount ? ratingSum / ratingCount : null })) };
}
