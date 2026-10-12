import type { Request, Response } from 'express';
import { z } from 'zod';

import { parseUrl } from '../services/parsing.service.js';
import { prisma } from '../lib/prisma.js';
import { requestUserId } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';

const StartSchema = z.object({
  url: z.string().url(),
});

export async function start(req: Request, res: Response): Promise<void> {
  const { url } = StartSchema.parse(req.body);
  const result = await parseUrl(url, requestUserId(req));
  res.json(result);
}

export async function status(req: Request, res: Response): Promise<void> {
  const batch = await prisma.uploadBatch.findFirst({ where: {
    id: req.params.jobId as string, userId: requestUserId(req), source: 'parsing',
  }, select: { id: true, status: true } });
  if (!batch) throw new HttpError(404, 'Импорт не найден');
  res.json({ jobId: batch.id, status: batch.status });
}

export async function history(req: Request, res: Response): Promise<void> {
  const userId = requestUserId(req);
  const items = await prisma.uploadBatch.findMany({
    where: { source: 'parsing', userId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, filename: true, count: true, createdAt: true },
  });
  res.json({ items });
}
