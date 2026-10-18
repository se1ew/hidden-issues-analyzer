import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';
import { ownedProductScope } from './ownership.service.js';
import type { DataScope } from '../schemas/data-scope.schema.js';
import { readRunData } from './run-data.service.js';

export async function resolveRunScope(userId: string, query: DataScope): Promise<DataScope> {
  if (query.runId || !query.productId) return query;
  const product = await prisma.product.findFirst({ where: { id: query.productId, userId },
    select: { publishedGrouping: { select: { runId: true } } } });
  if (!product) throw new HttpError(404, 'Товар не найден');
  return { ...query, ...(product.publishedGrouping ? { runId: product.publishedGrouping.runId } : {}) };
}
export async function scopedOverview(userId: string, query: DataScope) {
  const scope = await resolveRunScope(userId, query);
  if (scope.runId) {
    const data = await readRunData(userId, scope);
    return { ...data.overview, scope: data.scope, analytics: data.analytics };
  }
  const where = ownedProductScope(userId, scope.productId);
  const [loadedTotal, unprocessedCount] = await Promise.all([prisma.review.count({ where }), prisma.review.count({ where: { ...where, analyzedAt: null } })]);
  return { total: loadedTotal, analyzed: 0, pending: 0, loadedTotal, unprocessedCount, scopeTotal: null,
    succeededCount: 0, failedCount: 0, remainingCount: null, coverageRatio: null, hasRun: false, runStatus: null,
    problemCount: null, hiddenProblemCount: null, newProblemCount: null, signalCount: null,
    avgRating: null, sentiment: { positive: 0, negative: 0, neutral: 0 }, negativePct: 0,
    issuesCount: 0, publicationId: null, scope: { productId: scope.productId ?? null, runId: null, period: null } };
}
