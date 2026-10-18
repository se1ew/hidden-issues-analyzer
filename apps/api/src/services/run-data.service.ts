import type { Prisma } from '@prisma/client';
import { summarizeInputs, calendarAnalytics } from './run-analytics.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';
import type { DataScope } from '../schemas/data-scope.schema.js';
import { assertRunPeriod } from './data-scope.js';

export async function readRunData(userId: string, query: DataScope, db: Prisma.TransactionClient = prisma) {
  const run = await db.analysisRun.findFirst({ where: { id: query.runId, productId: query.productId, userId, product: { userId } } });
  if (!run || !query.runId || !query.productId) throw new HttpError(404, 'Запуск выбранного товара не найден');
  assertRunPeriod(run.scope, query);
  const publication = await db.groupingPublication.findFirst({ where: { runId: run.id, sealedAt: { not: null } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, _count: { select: { snapshots: true } },
      snapshots: { select: { scope: true, metrics: true, problem: { select: { status: true } } } } } });
  const inputs = await db.analysisRunReview.findMany({ where: { runId: run.id }, orderBy: { id: 'asc' },
    include: { analysis: { include: { aspects: true, issues: { include: { clusters: {
      where: { cluster: { publicationId: publication?.id ?? '' } },
      select: { cluster: { select: { id: true, title: true, publicationId: true, runId: true, productId: true } } },
    } } } } } } });
  const ownerScope = { productId: run.productId, product: { userId } };
  const [loadedTotal, unprocessedCount] = await Promise.all([db.review.count({ where: ownerScope }), db.review.count({ where: { ...ownerScope, analyzedAt: null } })]);
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
  const failedCount = inputs.filter(item => item.analysis?.status === 'failed').length;
  const remainingCount = inputs.length - successful.length - failedCount;
  const groups = publication?.snapshots ?? [];
  const metrics = (item: typeof groups[number]) => (item.metrics ?? {}) as { signal?: boolean; hidden?: boolean };
  const problems = groups.filter(item => item.scope === 'product' && metrics(item).signal === false);
  return { run, inputs, publication, analytics: summarizeInputs(inputs),
    scope: { productId: run.productId, runId: run.id, period: (run.scope as { period?: unknown }).period ?? null },
    overview: { total: inputs.length, analyzed: successful.length, pending: remainingCount,
      loadedTotal, scopeTotal: inputs.length, succeededCount: successful.length, failedCount, remainingCount, unprocessedCount,
      coverageRatio: inputs.length ? successful.length / inputs.length : null, hasRun: true, runStatus: run.status,
      problemCount: publication ? problems.length : null, hiddenProblemCount: publication ? problems.filter(item => metrics(item).hidden).length : null,
      newProblemCount: publication ? problems.filter(item => item.problem?.status === 'new').length : null,
      signalCount: publication ? groups.filter(item => metrics(item).signal).length : null,
      failed: failedCount,
      avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      sentiment, negativePct: sentimentTotal ? 100 * sentiment.negative / sentimentTotal : 0,
      issuesCount: publication?._count.snapshots ?? 0, publicationId: publication?.id ?? null },
    aspects: [...aspects.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)) };
}

export function runTimeseries(data: Awaited<ReturnType<typeof readRunData>>, bucket: 'day' | 'week' | 'month', days: number) {
  return { scope: data.scope, ...calendarAnalytics(data.inputs, data.run, days, bucket) };
}
