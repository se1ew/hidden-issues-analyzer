import { logger } from '../lib/logger.js';
import { randomUUID } from 'node:crypto';
import { Prisma, type UploadSource } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';

export interface ImportRow {
  text: string;
  rating?: number;
  date?: Date;
  externalId?: string;
  authorExternalId?: string;
  rowNumber?: number;
}

/** Bounded transactional chunk. Explicit IDs deduplicate; missing IDs remain independent. */
export async function persistImportRows(tx: Prisma.TransactionClient, productId: string, source: string, batchId: string, rows: ImportRow[], importedAt: Date) {
  const seen = new Map<string, string>();
  const externalIds = [...new Set(rows.flatMap(row => row.externalId ? [row.externalId] : []))];
  for (let i = 0; i < externalIds.length; i += 500) {
    for (const row of await tx.review.findMany({ where: { productId, source, externalId: { in: externalIds.slice(i, i + 500) } }, select: { id: true, externalId: true } })) {
      if (row.externalId) seen.set(row.externalId, row.id);
    }
  }
  const additions: Prisma.ReviewCreateManyInput[] = [];
  const occurrences = new Map<string, number>();
  rows.forEach((row, index) => {
    let reviewId = row.externalId ? seen.get(row.externalId) : undefined;
    if (!reviewId) {
      reviewId = randomUUID();
      if (row.externalId) seen.set(row.externalId, reviewId);
      additions.push({ id: reviewId, productId, uploadBatchId: batchId, source, externalId: row.externalId,
        authorExternalId: row.authorExternalId, text: row.text, rating: row.rating, reviewDate: row.date, importedAt });
    }
    if (!occurrences.has(reviewId)) occurrences.set(reviewId, row.rowNumber ?? index + 1);
  });
  for (let i = 0; i < additions.length; i += 500) await tx.review.createMany({ data: additions.slice(i, i + 500) });
  const sightings = [...occurrences].map(([reviewId, rowNumber]) => ({ reviewId, uploadBatchId: batchId, rowNumber }));
  for (let i = 0; i < sightings.length; i += 500) await tx.reviewImportOccurrence.createMany({ data: sightings.slice(i, i + 500), skipDuplicates: true });
  return { count: additions.length, skippedCount: rows.length - additions.length, reviewIds: additions.map(row => row.id as string) };
}

// All writes are atomic; external IDs deduplicate within a product and source.
// Text alone is never a duplicate key.
export async function persistImport(input: {
  userId: string;
  productId?: string;
  productName: string;
  source: UploadSource;
  externalSource?: string;
  productExternalId?: string;
  sourceUrl?: string;
  filename?: string;
  rows: ImportRow[];
  createNewProduct?: boolean;
  totalCount?: number;
  errorCount?: number;
  diagnostics?: Prisma.InputJsonObject;
  batchId?: string;
}) {
  if (!input.userId) throw new HttpError(401, 'Unauthorized');
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const source = input.externalSource ?? input.source;
        const productSource = input.externalSource ?? 'local';
        let product = input.createNewProduct && !input.productId ? null : await tx.product.findFirst({ where: input.productId
          ? { id: input.productId, userId: input.userId }
          : { userId: input.userId, source: productSource, ...(input.productExternalId
            ? { externalId: input.productExternalId }
            : { name: input.productName, externalId: null }) },
        });
        if (!product && input.productId) throw new HttpError(404, 'Товар не найден');
        product ??= await tx.product.create({ data: {
          name: input.productName, userId: input.userId, source: productSource,
          externalId: input.productExternalId, sourceUrl: input.sourceUrl,
        } });
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${product.id} FOR UPDATE`;
        if (input.batchId) await tx.$queryRaw`SELECT id FROM "UploadBatch" WHERE id = ${input.batchId} FOR UPDATE`;
        const startedAt = new Date();
        if (input.batchId && !await tx.uploadBatch.findFirst({ where: { id: input.batchId, userId: input.userId,
          productId: product.id, source: input.source, status: 'running' } })) throw new HttpError(409, 'Импорт уже остановлен');
        const batchData = {
          userId: input.userId, productId: product.id, source: input.source,
          filename: input.filename, status: 'running' as const, count: input.totalCount ?? input.rows.length, startedAt,
        };
        const batch = input.batchId ? await tx.uploadBatch.update({ where: { id: input.batchId }, data: batchData })
          : await tx.uploadBatch.create({ data: batchData });
        const chunk = await persistImportRows(tx, product.id, source, batch.id, input.rows, startedAt);
        const { skippedCount } = chunk;
        await tx.uploadBatch.update({ where: { id: batch.id }, data: {
          status: input.errorCount ? 'partial' : 'completed', addedCount: chunk.count, skippedCount,
          errorCount: input.errorCount ?? 0,
          finishedAt: new Date(), diagnostics: { ...input.diagnostics, provenance: 'linked', countsVerified: true },
        } });
        return { count: chunk.count, skippedCount, batchId: batch.id,
          totalCount: input.totalCount ?? input.rows.length, validCount: input.rows.length,
          errorCount: input.errorCount ?? 0, status: input.errorCount ? 'partial' : 'completed',
          productId: product.id, reviewIds: chunk.reviewIds };
      }, { isolationLevel: 'Serializable', timeout: 30_000 });
      logger.info({ importId: result.batchId, productId: result.productId, addedCount: result.count, skippedCount: result.skippedCount }, 'Import committed');
      return result;
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError
        && ['P2034', 'P2002'].includes(error.code)) continue;
      throw error;
    }
  }
}
