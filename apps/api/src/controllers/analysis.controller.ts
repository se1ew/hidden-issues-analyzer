import type { Request, Response } from 'express';
import { requestUserId } from '../middleware/auth.js';
import { requireOwnedProduct } from '../services/ownership.service.js';

import { getOverviewStats, getSentimentTimeseries, type Bucket } from '../services/stats.service.js';
import { generateProductSummary } from '../services/summary.service.js';
import { CreateAnalysisRunSchema, ListAnalysisRunsSchema } from '../schemas/analysis-runs.schema.js';
import { createAnalysisRun, getAnalysisRun, listAnalysisRuns, cancelAnalysisRun, retryFailedAnalysisRun } from '../services/analysis-runs.service.js';
import { enqueueAnalysisRun, notifyAnalysisRun } from '../lib/analysis-queue.js';
import { logger } from '../lib/logger.js';
import { llm, publicProviderConfiguration } from '../lib/llm.js';

export async function provider(_req: Request, res: Response): Promise<void> {
  res.json(publicProviderConfiguration());
}

export async function checkProvider(_req: Request, res: Response): Promise<void> {
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  await llm.check(controller.signal);
  res.json({ ...publicProviderConfiguration(), available: true });
}

export async function run(req: Request, res: Response): Promise<void> {
  const input = CreateAnalysisRunSchema.parse(req.body ?? {});
  const userId = requestUserId(req);
  await requireOwnedProduct(userId, input.productId);
  const preflight = new AbortController();
  res.once('close', () => { if (!res.writableEnded) preflight.abort(); });
  await llm.check(preflight.signal);
  const created = await createAnalysisRun(userId, input);
  let dispatchPending = false;
  try { await enqueueAnalysisRun(created.id); }
  catch { dispatchPending = true; logger.warn({ runId: created.id }, 'Run committed; queue delivery awaits dispatcher'); }
  res.status(202).json({ ...created, runId: created.id, jobId: created.id, dispatchPending });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const runId = (req.params.runId ?? req.params.jobId) as string;
  const state = await cancelAnalysisRun(runId, requestUserId(req));
  void notifyAnalysisRun(runId);
  res.json({ ...state, ok: true, cancelled: !!state.cancelRequestedAt });
}

export async function retryFailed(req: Request, res: Response): Promise<void> {
  const created = await retryFailedAnalysisRun(req.params.runId as string, requestUserId(req));
  let dispatchPending = false;
  try { await enqueueAnalysisRun(created.id); } catch { dispatchPending = true; }
  res.status(202).json({ ...created, jobId: created.id, dispatchPending });
}

export async function getRun(req: Request, res: Response): Promise<void> {
  res.json(await getAnalysisRun(req.params.runId as string, requestUserId(req)));
}

export async function listRuns(req: Request, res: Response): Promise<void> {
  res.json(await listAnalysisRuns(requestUserId(req), ListAnalysisRunsSchema.parse(req.query)));
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
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  const text = await generateProductSummary(requestUserId(req), productId, controller.signal);
  res.json({ summary: text });
}
