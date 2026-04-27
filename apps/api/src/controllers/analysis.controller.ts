import type { Request, Response } from 'express';

import { runPendingAnalysis } from '../services/analyzer.service.js';
import { getOverviewStats, getSentimentTimeseries, type Bucket } from '../services/stats.service.js';
import { generateProductSummary } from '../services/summary.service.js';
import { getIO } from '../sockets/index.js';

export async function run(req: Request, res: Response): Promise<void> {
  const limit = Number(req.body?.limit) || 200;
  const jobId = `analysis-${Date.now()}`;

  // Возвращаем jobId сразу, анализ идёт в фоне с прогресс-эвентами через socket.io
  res.status(202).json({ jobId, message: 'Анализ запущен' });

  const io = getIO();
  const room = io.to(`job:${jobId}`);

  room.emit('analysis:step', { jobId, step: 'analyzing', label: 'Анализ тональности и аспектов' });
  room.emit('analysis:progress', { jobId, processed: 0, total: 0, step: 'analyzing' });

  runPendingAnalysis({
    limit,
    concurrency: 3,
    onProgress: (processed, total) => {
      room.emit('analysis:progress', { jobId, processed, total, step: 'analyzing' });
    },
  })
    .then(() => {
      room.emit('analysis:step', { jobId, step: 'done', label: 'Готово' });
      room.emit('analysis:complete', { jobId });
    })
    .catch((err: Error) => {
      room.emit('analysis:error', { jobId, message: err.message });
    });
}

export async function stats(req: Request, res: Response): Promise<void> {
  const productId = (req.query.productId as string) || undefined;
  const data = await getOverviewStats(productId);
  res.json(data);
}

export async function timeseries(req: Request, res: Response): Promise<void> {
  const bucket = ((req.query.bucket as string) || 'day') as Bucket;
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const productId = (req.query.productId as string) || undefined;
  const data = await getSentimentTimeseries(bucket, days, productId);
  res.json(data);
}

export async function summary(req: Request, res: Response): Promise<void> {
  const productId = (req.query.productId as string) || undefined;
  const text = await generateProductSummary(productId);
  res.json({ summary: text });
}
