import type { Request, Response } from 'express';
import { z } from 'zod';

import { parseUrl } from '../services/parsing.service.js';

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
