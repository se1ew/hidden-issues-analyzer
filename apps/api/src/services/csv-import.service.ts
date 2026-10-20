import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';
import { logger } from '../lib/logger.js';
import { ImportProductSchema } from '../schemas/products.schema.js';
import type { CsvOptions } from './csv.service.js';
import { inspectCsvFile } from './streaming-csv.service.js';
import { persistImportRows } from './imports.service.js';

export async function importCsvFile(input: { file: string; filename: string; userId: string; productId?: string; productName?: string; options?: CsvOptions; idempotencyKey?: string }) {
  ImportProductSchema.parse(input);
  const inspected = await inspectCsvFile(input.file, input.options);
  if (!inspected.mapping.text || !inspected.validCount) throw new HttpError(422, 'CSV не содержит валидных строк. Проверьте колонки и значения.', { totalCount: inspected.totalCount, errorCount: inspected.errorCount, errors: inspected.errors.slice(0, 100) });
  const requestHash = createHash('sha256').update(JSON.stringify({ sha256: inspected.sha256, mapping: inspected.mapping,
    delimiter: inspected.delimiter, productId: input.productId, productName: input.productName?.trim() })).digest('hex');
  const idempotencyKey = input.idempotencyKey ?? `csv-${requestHash}`;
  const diagnostics = { sha256: inspected.sha256, delimiter: inspected.delimiter, mapping: inspected.mapping,
    errors: inspected.errors.map(error => ({ ...error })), provenance: 'linked', checkpointVersion: 1 };
  let batch;
  for (let attempt = 0; ; attempt++) {
    try {
      batch = await prisma.$transaction(async tx => {
        const existing = await tx.uploadBatch.findUnique({ where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey } } });
        if (existing) {
          if (existing.requestHash !== requestHash) throw new HttpError(409, 'Ключ импорта уже использован для другого файла, товара или сопоставления.', undefined, 'idempotency_conflict');
          if (!await tx.product.findFirst({ where: { id: existing.productId!, userId: input.userId } })) throw new HttpError(404, 'Товар не найден');
          return existing;
        }
        const product = input.productId ? await tx.product.findFirst({ where: { id: input.productId, userId: input.userId } })
          : await tx.product.create({ data: { name: input.productName!.trim(), userId: input.userId, source: 'local' } });
        if (!product) throw new HttpError(404, 'Товар не найден');
        return tx.uploadBatch.create({ data: { userId: input.userId, productId: product.id, source: 'csv', filename: input.filename.slice(0, 200),
          status: 'running', startedAt: new Date(), count: inspected.totalCount, errorCount: inspected.errorCount,
          idempotencyKey, requestHash, diagnostics } });
      }, { isolationLevel: 'Serializable' });
      break;
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) continue;
      throw error;
    }
  }
  const summary = (value: typeof batch) => ({ count: value!.addedCount, skippedCount: value!.skippedCount,
    batchId: value!.id, productId: value!.productId!, totalCount: value!.count,
    validCount: value!.count - value!.errorCount, errorCount: value!.errorCount, status: value!.status });
  if (['completed', 'partial'].includes(batch.status)) return summary(batch);
  try {
    await inspectCsvFile(input.file, input.options, async (rows, throughRecord) => {
      await prisma.$transaction(async tx => {
        // Serialize duplicate HTTP deliveries and synchronize product removal.
        const product = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Product" WHERE id = ${batch.productId} AND "userId" = ${input.userId} FOR UPDATE`;
        if (!product.length) throw new HttpError(404, 'Товар не найден');
        await tx.$queryRaw`SELECT id FROM "UploadBatch" WHERE id = ${batch.id} FOR UPDATE`;
        const current = await tx.uploadBatch.findUniqueOrThrow({ where: { id: batch.id } });
        if (current.processedCount >= throughRecord) return;
        const result = await persistImportRows(tx, batch.productId!, 'csv', batch.id, rows, batch.startedAt!);
        await tx.uploadBatch.update({ where: { id: batch.id }, data: { status: 'running', processedCount: throughRecord,
          addedCount: { increment: result.count }, skippedCount: { increment: result.skippedCount } } });
      }, { timeout: 30000 });
    });
    const finished = await prisma.uploadBatch.update({ where: { id: batch.id }, data: { status: inspected.errorCount ? 'partial' : 'completed', finishedAt: new Date() } });
    logger.info({ importId: batch.id, productId: batch.productId, addedCount: finished.addedCount }, 'Streaming import completed');
    return summary(finished);
  } catch {
    await prisma.uploadBatch.updateMany({ where: { id: batch.id, status: 'running', processedCount: { lt: inspected.totalCount } }, data: { status: 'interrupted' } }).catch(() => undefined);
    logger.warn({ importId: batch.id }, 'Import checkpoint retained');
    throw new HttpError(503, 'Импорт прерван. Повторите загрузку того же файла: сохранённые пакеты будут пропущены.', { batchId: batch.id }, 'import_interrupted');
  }
}
