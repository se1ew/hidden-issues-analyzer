import { Prisma, type Review, type Sentiment } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';
import { LIMITS } from '../lib/resource-limits.js';
import type { ListReviewsQuery } from '../schemas/reviews.schema.js';

export interface CurrentReview extends Review {
  sentiment: Sentiment | null; sentimentScore: number | null; analyzedAt: Date | null;
  aspects: unknown[]; issues: string[]; evidence: unknown[]; hiddenIssueId: null;
  analysisStatus: 'succeeded' | null; product: { id: string; name: string }; legacyResultAvailable: boolean;
}
export async function currentAnalysisIds(db: Prisma.TransactionClient, productId: string): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ reviewId: string }>>`SELECT a."reviewId" FROM "CurrentReviewAnalysis" a JOIN "Review" r ON r.id = a."reviewId" WHERE r."productId" = ${productId}`;
  return rows.map(row => row.reviewId);
}
export async function countCurrentAnalyses(userId: string, productId?: string, db: Prisma.TransactionClient = prisma) {
  const [row] = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "CurrentReviewAnalysis" a JOIN "Review" r ON r.id = a."reviewId" JOIN "Product" p ON p.id = r."productId" WHERE p."userId" = ${userId} ${productId ? Prisma.sql`AND p.id = ${productId}` : Prisma.empty}`;
  return row.count;
}
export async function listCurrentReviews(query: ListReviewsQuery, userId: string, db: Prisma.TransactionClient = prisma, exportAll = false, reviewId?: string) {
  if (!userId) throw new HttpError(401, 'Unauthorized');
  const clauses = [Prisma.sql`p."userId" = ${userId}`];
  if (reviewId) clauses.push(Prisma.sql`r.id = ${reviewId}`);
  if (query.productId) clauses.push(Prisma.sql`r."productId" = ${query.productId}`);
  if (query.from) clauses.push(Prisma.sql`r."reviewDate" >= ${new Date(query.from)} AND r."reviewDate" < ${new Date(query.to!)}`);
  if (query.rating !== undefined) clauses.push(Prisma.sql`r.rating = ${query.rating}`);
  if (query.sentiment) clauses.push(Prisma.sql`a.sentiment::text = ${query.sentiment}`);
  if (query.hasIssues !== undefined) clauses.push(query.hasIssues ? Prisma.sql`jsonb_array_length(a.issues) > 0` : Prisma.sql`COALESCE(jsonb_array_length(a.issues), 0) = 0`);
  if (query.search) clauses.push(Prisma.sql`strpos(lower(r.text), lower(${query.search})) > 0`);
  const from = Prisma.sql`FROM "Review" r JOIN "Product" p ON p.id = r."productId" LEFT JOIN "CurrentReviewAnalysis" a ON a."reviewId" = r.id WHERE ${Prisma.join(clauses, ' AND ')}`;
  const [count] = await db.$queryRaw<Array<{ total: number }>>`SELECT count(*)::int AS total ${from}`;
  if (exportAll && count.total > LIMITS.exportRows) throw new HttpError(413, 'Экспорт превышает 2000 отзывов. Уточните область; частичный файл не создаётся.');
  const items = await db.$queryRaw<CurrentReview[]>`SELECT r.*, a.sentiment, a."sentimentScore", a."analyzedAt",
    COALESCE(a.aspects, '[]'::jsonb) AS aspects, COALESCE(a.issues, '[]'::jsonb) AS issues,
    COALESCE(a.evidence, '[]'::jsonb) AS evidence, NULL::text AS "hiddenIssueId",
    CASE WHEN a."analysisId" IS NOT NULL THEN 'succeeded' ELSE NULL END AS "analysisStatus",
    jsonb_build_object('id', p.id, 'name', p.name) AS product,
    EXISTS (SELECT 1 FROM "LegacyReviewResult" l WHERE l."reviewId" = r.id) AS "legacyResultAvailable"
    ${from} ORDER BY r."createdAt" DESC, r.id ASC ${exportAll ? Prisma.empty : Prisma.sql`LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`}`;
  return { items, total: count.total, page: query.page, pageSize: query.pageSize };
}
