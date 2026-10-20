import { listCurrentReviews } from './current-reviews.js';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import { persistImport } from './imports.service.js';
import { ownedProductScope } from './ownership.service.js';
import { HttpError } from '../middleware/error.js';
import type { CreateManualReviewInput, ListReviewsQuery } from '../schemas/reviews.schema.js';
import { inspectReviewsCsv, type CsvOptions } from './csv.service.js';
import { ImportProductSchema } from '../schemas/products.schema.js';
import { readRunData } from './run-data.service.js';

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
  return inspectReviewsCsv(buffer).rows;
}

export async function importReviewsFromCsv(
  buffer: Buffer, filename: string, userId: string, productName?: string, productId?: string, options: CsvOptions = {},
) {
  ImportProductSchema.parse({ productId, productName });
  const inspected = inspectReviewsCsv(buffer, options);
  if (!inspected.mapping.text || inspected.rows.length === 0) {
    throw new HttpError(422, 'CSV не содержит валидных строк. Проверьте колонки и значения.',
      { totalCount: inspected.totalCount, errorCount: inspected.errorCount, errors: inspected.errors.slice(0, 100) });
  }
  const result = await persistImport({ userId, productId,
    productName: productName?.trim() ?? '', createNewProduct: !productId,
    source: 'csv', filename: filename.slice(0, 200), rows: inspected.rows,
    totalCount: inspected.totalCount, errorCount: inspected.errorCount,
    diagnostics: { sha256: inspected.sha256, delimiter: inspected.delimiter,
      mapping: inspected.mapping, errors: inspected.errors.map((error) => ({ ...error })),
      noExternalIdCount: inspected.rows.filter((row) => !row.externalId).length } });
  const { reviewIds: _ids, ...summary } = result;
  return summary;
}

export async function createManualReview(input: CreateManualReviewInput, userId: string): Promise<{ id: string; productId: string }> {
  ImportProductSchema.parse(input);
  const result = await persistImport({ userId, productId: input.productId,
    productName: input.productName ?? '', source: 'manual', createNewProduct: !input.productId,
    rows: [{ text: input.text, rating: input.rating }] });
  return { id: result.reviewIds[0], productId: result.productId };
}

export async function listReviews(query: ListReviewsQuery, userId: string, db: Prisma.TransactionClient = prisma, exportAll = false) {
  if (query.runId) {
    const data = await readRunData(userId, query, db);
    const selected = data.inputs.filter(item => (!query.sentiment || item.analysis?.sentiment === query.sentiment)
      && (query.rating === undefined || item.rating === query.rating)
      && (query.hasIssues === undefined || !!item.analysis?.issues.length === query.hasIssues)
      && (!query.search || item.text.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())));
    return { items: (exportAll ? selected : selected.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)).map(item => ({
      id: item.sourceReviewId, inputId: item.id, text: item.text, rating: item.rating,
      reviewDate: item.reviewDate, source: item.source, externalId: item.externalId,
      sentiment: item.analysis?.sentiment ?? null, sentimentScore: item.analysis?.sentimentScore ?? null,
      aspects: item.analysis?.aspects ?? [], issues: item.analysis?.issues.map(issue => issue.defect) ?? [],
      evidence: item.analysis?.issues.map(issue => ({ ...issue, groupLinks: issue.clusters?.map(member => member.cluster) ?? [] })) ?? [], analysisStatus: item.analysis?.status ?? 'pending',
      errorCode: item.analysis?.errorCode ?? null,
      hiddenIssueId: null, analyzedAt: item.analysis?.finishedAt ?? null, createdAt: item.importedAt,
      productId: data.run.productId, product: null,
    })), total: selected.length, page: query.page, pageSize: query.pageSize, scope: data.scope, offsetUnit: 'utf16' };
  }
  return listCurrentReviews(query, userId, db, exportAll);
}

export async function getReview(id: string, userId: string) {
  const result = await listCurrentReviews({ page: 1, pageSize: 1 } as ListReviewsQuery, userId, prisma, false, id);
  if (!result.items[0]) throw new HttpError(404, 'Отзыв не найден');
  return result.items[0];
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
