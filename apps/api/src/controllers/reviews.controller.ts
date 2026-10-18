import { requestUserId } from '../middleware/auth.js';
import 'multer'; // augments Express.Request with `file` and `files`
import type { Request, Response } from 'express';
import { z } from 'zod';

import { HttpError } from '../middleware/error.js';
import * as reviewsService from '../services/reviews.service.js';
import { ListReviewsQuerySchema, type CreateManualReviewInput, type ListReviewsQuery } from '../schemas/reviews.schema.js';
import { CsvOptionsSchema, inspectReviewsCsv } from '../services/csv.service.js';
import { ImportProductSchema } from '../schemas/products.schema.js';
import { prisma } from '../lib/prisma.js';

function csvOptions(req: Request) {
  let mapping: unknown;
  try { mapping = req.body?.mapping ? JSON.parse(req.body.mapping as string) : undefined; }
  catch { throw new HttpError(422, 'Некорректное сопоставление колонок'); }
  return CsvOptionsSchema.parse({ delimiter: req.body?.delimiter || undefined, mapping });
}

export async function previewCsv(req: Request, res: Response): Promise<void> {
  if (!req.file) throw new HttpError(400, 'Файл не загружен (поле: file)');
  const { rows: _rows, errors, ...result } = inspectReviewsCsv(req.file.buffer, csvOptions(req));
  res.json({ ...result, errors: errors.slice(0, 100), errorsTruncated: errors.length > 100 });
}

export async function importDetails(req: Request, res: Response): Promise<void> {
  const batch = await prisma.uploadBatch.findFirst({ where: {
    id: req.params.id as string, userId: requestUserId(req), product: { userId: requestUserId(req) }, source: 'csv',
  }, select: { id: true, productId: true, filename: true, status: true, count: true,
    addedCount: true, skippedCount: true, errorCount: true, diagnostics: true, createdAt: true } });
  if (!batch) throw new HttpError(404, 'Импорт не найден');
  res.json(batch);
}

export async function downloadImportErrors(req: Request, res: Response): Promise<void> {
  const batch = await prisma.uploadBatch.findFirst({ where: {
    id: req.params.id as string, userId: requestUserId(req), product: { userId: requestUserId(req) }, source: 'csv',
  }, select: { diagnostics: true } });
  if (!batch) throw new HttpError(404, 'Импорт не найден');
  const diagnostics = z.object({ errors: z.array(z.object({
    rowNumber: z.number().int().positive(), field: z.string(), message: z.string(),
  })) }).safeParse(batch.diagnostics);
  if (!diagnostics.success) throw new HttpError(404, 'Диагностика строк недоступна');
  const cell = (value: string) => `"${value.replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
  const csv = ['record,field,error', ...diagnostics.data.errors.map((error) =>
    `${error.rowNumber},${cell(error.field)},${cell(error.message)}`)].join('\r\n');
  res.attachment('import-errors.csv').type('text/csv; charset=utf-8').send(`\uFEFF${csv}`);
}

export async function list(req: Request, res: Response): Promise<void> {
  const result = await reviewsService.listReviews(req.query as unknown as ListReviewsQuery, requestUserId(req));
  res.json(result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const review = await reviewsService.getReview(id, requestUserId(req));
  res.json(review);
}

export async function uploadCsv(req: Request, res: Response): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) throw new HttpError(400, 'Файл не загружен (поле: file)');
  const { productName, productId } = ImportProductSchema.parse(req.body ?? {});
  const result = await reviewsService.importReviewsFromCsv(
    file.buffer,
    file.originalname,
    requestUserId(req),
    productName,
    productId,
    csvOptions(req),
  );
  res.status(201).json(result);
}

export async function createManual(req: Request, res: Response): Promise<void> {
  const result = await reviewsService.createManualReview(
    req.body as CreateManualReviewInput,
    requestUserId(req),
  );
  res.status(201).json(result);
}

export async function deleteOne(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  await reviewsService.deleteReview(id, requestUserId(req));
  res.status(204).end();
}

export async function deleteBulk(req: Request, res: Response): Promise<void> {
  const productId = (req.query.productId as string) || undefined;
  const count = await reviewsService.deleteReviewsBulk(requestUserId(req), productId);
  res.json({ deleted: count });
}

export async function exportCsv(req: Request, res: Response): Promise<void> {
  const query = ListReviewsQuerySchema.parse(req.query);
  const data = await prisma.$transaction(db => reviewsService.listReviews(query, requestUserId(req), db, true), { isolationLevel: 'RepeatableRead', timeout: 30000 });
  const { csvDocument } = await import('../services/csv-export.js');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="reviews.csv"');
  res.send(csvDocument([['id', 'text', 'rating', 'sentiment', 'issues', 'reviewDate', 'importedAt', 'source', 'productId', 'runId'],
    ...data.items.map(item => [item.id, item.text, item.rating, item.sentiment, JSON.stringify(item.issues ?? []), item.reviewDate, item.createdAt, item.source, item.productId, query.runId ?? ''])]));
}
