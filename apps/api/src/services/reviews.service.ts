import { parse } from 'csv-parse/sync';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { persistImport } from './imports.service.js';
import { ownedProductScope } from './ownership.service.js';
import { HttpError } from '../middleware/error.js';
import type { CreateManualReviewInput, ListReviewsQuery } from '../schemas/reviews.schema.js';
import { UNASSIGNED_PRODUCT_ID } from './products.service.js';

export interface ParsedCsvRow {
  text: string;
  rating?: number;
  date?: Date;
  externalId?: string;
  authorExternalId?: string;
}

/**
 * Парсит CSV-буфер. Поддерживает разделители «,» и «;»,
 * заголовки text/review/comment, rating/score/stars, date/created_at.
 */
export function parseReviewsCsv(buffer: Buffer): ParsedCsvRow[] {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const delimiter = (text.split('\n', 1)[0] ?? '').includes(';') ? ';' : ',';

  const records = parse(text, {
    delimiter,
    columns: (headers: string[]) =>
      headers.map((h) => h.toString().toLowerCase().trim().replace(/\s+/g, '_')),
    skip_empty_lines: true,
    trim: false,
    relax_quotes: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: ParsedCsvRow[] = [];
  for (const r of records) {
    const text =
      r.text ?? r.review ?? r.comment ?? r.feedback ?? r.review_text ?? r.content ?? '';
    if (!text || text.trim().length < 3) continue;

    const ratingRaw = r.rating ?? r.score ?? r.stars ?? r.mark;
    const rating = ratingRaw ? Number(ratingRaw.replace(',', '.')) : undefined;

    const dateRaw = r.date ?? r.created_at ?? r.review_date ?? r.published_at;
    let date: Date | undefined;
    if (dateRaw) {
      const d = new Date(dateRaw);
      if (!Number.isNaN(d.getTime())) date = d;
    }

    rows.push({
      text,
      externalId: (r.external_id ?? r.review_id ?? '').trim() || undefined,
      authorExternalId: (r.author_id ?? '').trim() || undefined,
      rating: Number.isFinite(rating) && rating! >= 1 && rating! <= 5 ? Math.round(rating!) : undefined,
      date,
    });
  }

  return rows;
}

export async function importReviewsFromCsv(
  buffer: Buffer, filename: string, userId: string, productName?: string, productId?: string,
) {
  const rows = parseReviewsCsv(buffer);
  if (!rows.length) throw new HttpError(422, 'CSV не содержит валидных строк');
  const result = await persistImport({ userId, productId,
    productName: productName?.trim() || filename.replace(/\.[a-z0-9]+$/i, '').slice(0, 200) || 'Импорт CSV',
    source: 'csv', filename, rows });
  const { reviewIds: _ids, ...summary } = result;
  return summary;
}

export async function createManualReview(input: CreateManualReviewInput, userId: string): Promise<{ id: string; productId: string }> {
  const result = await persistImport({ userId, productId: input.productId,
    productName: input.productName || 'Отзывы вручную', source: 'manual', rows: [{ text: input.text, rating: input.rating }] });
  return { id: result.reviewIds[0], productId: result.productId };
}

export async function listReviews(query: ListReviewsQuery, userId: string) {
  const where: Prisma.ReviewWhereInput = ownedProductScope(userId, query.productId);
  if (query.sentiment) where.sentiment = query.sentiment;
  if (query.rating) where.rating = query.rating;
  if (query.hasIssues !== undefined) {
    where.hiddenIssueId = query.hasIssues ? { not: null } : null;
  }
  if (query.search) {
    where.text = { contains: query.search, mode: 'insensitive' };
  }
  if (query.productId) {
    where.productId = query.productId === UNASSIGNED_PRODUCT_ID ? null : query.productId;
  }

  const [items, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        text: true,
        rating: true,
        sentiment: true,
        sentimentScore: true,
        issues: true,
        aspects: true,
        hiddenIssueId: true,
        analyzedAt: true,
        createdAt: true,
        productId: true,
        product: { select: { id: true, name: true } },
      },
    }),
    prisma.review.count({ where }),
  ]);

  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getReview(id: string, userId: string) {
  const review = await prisma.review.findFirst({
    where: { id, ...ownedProductScope(userId) },
    include: { hiddenIssue: true, product: true },
  });
  if (!review) throw new HttpError(404, 'Отзыв не найден');
  if (review.hiddenIssue && review.hiddenIssue.productId !== review.productId) {
    review.hiddenIssue = null;
  }
  return review;
}

export async function deleteReview(id: string, userId: string): Promise<void> {
  const review = await prisma.review.findFirst({ where: { id, ...ownedProductScope(userId) } });
  if (!review) throw new HttpError(404, 'Отзыв не найден');
  await prisma.review.deleteMany({ where: { id, ...ownedProductScope(userId) } });
}

export async function deleteReviewsBulk(userId: string, productId?: string): Promise<number> {
  const result = await prisma.review.deleteMany({ where: ownedProductScope(userId, productId) });
  return result.count;
}
