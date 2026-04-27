import { parse } from 'csv-parse/sync';
import type { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { HttpError } from '../middleware/error.js';
import type { CreateManualReviewInput, ListReviewsQuery } from '../schemas/reviews.schema.js';
import { UNASSIGNED_PRODUCT_ID } from './products.service.js';

export interface ParsedCsvRow {
  text: string;
  rating?: number;
  date?: Date;
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
    trim: true,
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
      text: text.trim(),
      rating: Number.isFinite(rating) && rating! >= 1 && rating! <= 5 ? Math.round(rating!) : undefined,
      date,
    });
  }

  return rows;
}

export async function importReviewsFromCsv(
  buffer: Buffer,
  filename: string,
  userId: string | null,
  productName?: string,
): Promise<{ count: number; batchId: string; productId: string | null }> {
  const rows = parseReviewsCsv(buffer);
  if (rows.length === 0) {
    throw new HttpError(422, 'CSV не содержит валидных строк (нет колонки text/review/comment)');
  }

  // Если указано имя товара — создаём/находим его, иначе используем имя файла
  let productId: string | null = null;
  const finalProductName = productName?.trim() || deriveProductNameFromFilename(filename);
  if (finalProductName) {
    const existing = await prisma.product.findFirst({ where: { name: finalProductName } });
    const product = existing ?? (await prisma.product.create({ data: { name: finalProductName } }));
    productId = product.id;
  }

  const batch = await prisma.uploadBatch.create({
    data: {
      userId,
      source: 'csv',
      filename,
      count: rows.length,
    },
  });

  // Чанки по 500 строк, чтобы не упереться в лимиты БД
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await prisma.review.createMany({
      data: chunk.map((r) => ({
        text: r.text,
        rating: r.rating ?? null,
        reviewDate: r.date ?? null,
        productId,
      })),
    });
  }

  logger.info({ batchId: batch.id, count: rows.length, userId, productId }, 'CSV import complete');
  return { count: rows.length, batchId: batch.id, productId };
}

function deriveProductNameFromFilename(filename: string): string | null {
  if (!filename) return null;
  const base = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return base ? base.slice(0, 200) : null;
}

export async function createManualReview(
  input: CreateManualReviewInput,
  userId: string | null,
): Promise<{ id: string }> {
  let productId: string | null = null;
  if (input.productName) {
    const existing = await prisma.product.findFirst({ where: { name: input.productName } });
    const product =
      existing ?? (await prisma.product.create({ data: { name: input.productName } }));
    productId = product.id;
  }

  const review = await prisma.review.create({
    data: {
      text: input.text,
      rating: input.rating ?? null,
      productId,
    },
  });

  await prisma.uploadBatch.create({
    data: { userId, source: 'manual', count: 1 },
  });

  return { id: review.id };
}

export async function listReviews(query: ListReviewsQuery) {
  const where: Prisma.ReviewWhereInput = {};
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

export async function getReview(id: string) {
  const review = await prisma.review.findUnique({
    where: { id },
    include: { hiddenIssue: true, product: true },
  });
  if (!review) throw new HttpError(404, 'Отзыв не найден');
  return review;
}
