import type { Request, Response } from 'express';

import { runPendingAnalysis } from '../services/analyzer.service.js';
import { getOverviewStats, getSentimentTimeseries, type Bucket } from '../services/stats.service.js';
import { generateProductSummary } from '../services/summary.service.js';
import { getIO, setJobState, deleteJobState } from '../sockets/index.js';

const jobCancels = new Map<string, AbortController>();

export async function run(req: Request, res: Response): Promise<void> {
  const limit = Number(req.body?.limit) || 200;
  const jobId = `analysis-${Date.now()}`;

  // Сохраняем состояние ДО ответа клиенту — если клиент подпишется сразу после,
  // он получит актуальный статус при job:subscribe (replay из jobStore)
  setJobState(jobId, {
    status: 'analyzing',
    processed: 0,
    total: 0,
    step: 'analyzing',
    label: 'Анализ тональности и аспектов',
  });

  // Возвращаем jobId сразу, анализ идёт в фоне с прогресс-эвентами через socket.io
  res.status(202).json({ jobId, message: 'Анализ запущен' });

  const io = getIO();
  const room = io.to(`job:${jobId}`);

  const controller = new AbortController();
  jobCancels.set(jobId, controller);

  const cleanup = () => {
    jobCancels.delete(jobId);
    setTimeout(() => deleteJobState(jobId), 30_000);
  };

  runPendingAnalysis({
    limit,
    concurrency: 1,
    signal: controller.signal,
    onProgress: (processed, total) => {
      setJobState(jobId, { processed, total });
      room.emit('analysis:progress', { jobId, processed, total, step: 'analyzing' });
    },
  })
    .then(() => {
      if (controller.signal.aborted) return;
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
