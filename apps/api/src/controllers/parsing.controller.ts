import type { Request, Response } from 'express';
import { z } from 'zod';

import { queueParsing, cancelParsing } from '../services/parsing-worker.service.js';
import { prisma } from '../lib/prisma.js';
import { requestUserId } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';

const StartSchema = z.object({
  url: z.string().trim().min(1).max(2048),
});

export async function start(req: Request, res: Response): Promise<void> {
  const { url } = StartSchema.parse(req.body);
  const result = await queueParsing(url, requestUserId(req));
  res.status(202).json(result);
}

export async function status(req: Request, res: Response): Promise<void> {
  const batch = await prisma.uploadBatch.findFirst({ where: {
    id: req.params.jobId as string, userId: requestUserId(req), source: 'parsing', product: { userId: requestUserId(req) },
  }, select: { id: true, status: true, productId: true, count: true, addedCount: true, skippedCount: true, errorCode: true, diagnostics: true } });
  if (!batch) throw new HttpError(404, 'Импорт не найден');
  const details = batch.diagnostics as { receivedCount?: number; ignoredCount?: number } | null;
  res.json({ jobId: batch.id, status: batch.status, source: 'wildberries', internalProductId: batch.productId,
    reviewsAdded: batch.addedCount, skippedCount: batch.skippedCount, receivedCount: details?.receivedCount ?? batch.count,
    ignoredCount: details?.ignoredCount ?? 0,
    errorCode: batch.errorCode, historyComplete: false, diagnostics: batch.diagnostics });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  await cancelParsing(req.params.jobId as string, requestUserId(req)); res.status(204).end();
}

export async function history(req: Request, res: Response): Promise<void> {
  const userId = requestUserId(req);
  const items = await prisma.uploadBatch.findMany({
    where: { source: 'parsing', userId, product: { userId } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, filename: true, count: true, addedCount: true, skippedCount: true, status: true, errorCode: true, createdAt: true },
  });
  res.json({ items });
}
