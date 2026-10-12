import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requestUserId } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { requireOwnedProduct } from '../services/ownership.service.js';

import { runPendingAnalysis } from '../services/analyzer.service.js';
import { getOverviewStats, getSentimentTimeseries, type Bucket } from '../services/stats.service.js';
import { generateProductSummary } from '../services/summary.service.js';
import { getIO, setJobState, deleteJobState, ownsJob, hasActiveJob } from '../sockets/index.js';

const jobCancels = new Map<string, AbortController>();

export async function run(req: Request, res: Response): Promise<void> {
  const { limit, productId } = z.object({
    limit: z.coerce.number().int().min(1).max(2000).default(200),
    productId: z.string().min(1).max(60).optional(),
  }).parse(req.body ?? {});
  const userId = requestUserId(req);
  if (productId) await requireOwnedProduct(userId, productId);
  if (hasActiveJob(userId, productId)) throw new HttpError(409, 'Анализ уже выполняется');
  const jobId = `analysis-${randomUUID()}`;
  const io = getIO();

  // Сохраняем состояние ДО ответа клиенту — если клиент подпишется сразу после,
  // он получит актуальный статус при job:subscribe (replay из jobStore)
  setJobState(jobId, {
    userId,
    productId,
    status: 'analyzing',
    processed: 0,
    total: 0,
    step: 'analyzing',
    label: 'Анализ тональности и аспектов',
  });

  // Возвращаем jobId сразу, анализ идёт в фоне с прогресс-эвентами через socket.io
  res.status(202).json({ jobId, message: 'Анализ запущен' });

  const room = io.to(`job:${jobId}`);

  const controller = new AbortController();
  jobCancels.set(jobId, controller);

  const cleanup = () => {
    jobCancels.delete(jobId);
    setTimeout(() => deleteJobState(jobId), 30_000);
  };

  runPendingAnalysis({
    userId,
    productId,
    limit,
    concurrency: 1,
    signal: controller.signal,
    onProgress: (processed, total) => {
      setJobState(jobId, { processed, total });
      room.emit('analysis:progress', { jobId, processed, total, step: 'analyzing' });
    },
  })
    .then((result) => {
      if (controller.signal.aborted) return;
      if (result.failed > 0) {
        const message = `Анализ завершён с ошибками: ${result.failed} из ${result.total} отзывов не обработаны`;
        setJobState(jobId, { status: 'error', error: message });
        room.emit('analysis:error', { jobId, message });
        cleanup();
        return;
      }
      setJobState(jobId, { status: 'complete', step: 'done', label: 'Готово' });
      room.emit('analysis:step', { jobId, step: 'done', label: 'Готово' });
      room.emit('analysis:complete', { jobId });
      cleanup();
    })
    .catch((err: Error) => {
      setJobState(jobId, { status: 'error', error: err.message });
      room.emit('analysis:error', { jobId, message: err.message });
      cleanup();
    });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const { jobId } = req.params as { jobId: string };
  if (!ownsJob(jobId, requestUserId(req))) throw new HttpError(404, 'Запуск не найден');
  const controller = jobCancels.get(jobId);
  if (controller) {
    controller.abort();
    jobCancels.delete(jobId);
    const io = getIO();
    const room = io.to(`job:${jobId}`);
    setJobState(jobId, { status: 'error', error: 'Анализ остановлен пользователем' });
    room.emit('analysis:cancelled', { jobId });
    setTimeout(() => deleteJobState(jobId), 30_000);
  }
  res.json({ ok: true, cancelled: !!controller });
}

export async function stats(req: Request, res: Response): Promise<void> {
  const productId = (req.query.productId as string) || undefined;
  const data = await getOverviewStats(requestUserId(req), productId);
  res.json(data);
}

export async function timeseries(req: Request, res: Response): Promise<void> {
  const bucket = ((req.query.bucket as string) || 'day') as Bucket;
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const productId = (req.query.productId as string) || undefined;
  const data = await getSentimentTimeseries(requestUserId(req), bucket, days, productId);
  res.json(data);
}

export async function summary(req: Request, res: Response): Promise<void> {
  const productId = (req.query.productId as string) || undefined;
  const text = await generateProductSummary(requestUserId(req), productId);
  res.json({ summary: text });
}
