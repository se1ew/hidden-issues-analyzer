import type { Request, Response } from 'express';
import { z } from 'zod';

import { parseUrl } from '../services/parsing.service.js';
import { prisma } from '../lib/prisma.js';

const StartSchema = z.object({
  url: z.string().url(),
});

export async function start(req: Request, res: Response): Promise<void> {
  const { url } = StartSchema.parse(req.body);
  const result = await parseUrl(url, req.user?.sub ?? null);
  res.json(result);
}

export async function status(req: Request, res: Response): Promise<void> {
  // Сейчас парсинг синхронный — этот эндпоинт оставлен для совместимости
  res.json({ jobId: req.params.jobId, status: 'completed' });
}

export async function history(req: Request, res: Response): Promise<void> {
  const userId = req.user?.sub;
  const items = await prisma.uploadBatch.findMany({
    where: { source: 'parsing', ...(userId ? { userId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, filename: true, count: true, createdAt: true },
  });
  res.json({ items });
}
