import type { Request, Response } from 'express';
import { requestUserId } from '../middleware/auth.js';
import { requireOwnedProduct } from '../services/ownership.service.js';

import { generateProductSummary } from '../services/summary.service.js';
import { CreateAnalysisRunSchema, ListAnalysisRunsSchema, ListAnalysisInputsSchema } from '../schemas/analysis-runs.schema.js';
import { createAnalysisRun, getAnalysisRun, listAnalysisRuns, listAnalysisInputs, cancelAnalysisRun, retryFailedAnalysisRun } from '../services/analysis-runs.service.js';
import { enqueueAnalysisRun, notifyAnalysisRun } from '../lib/analysis-queue.js';
import { logger } from '../lib/logger.js';
import { createProvider } from '../lib/llm.js';
import { publicLlmSettings, resolveLlmSettings, updateLlmSettings, userLlmProvider } from '../services/llm-settings.service.js';
import { z } from 'zod';
import { DataScopeSchema, scopeShape, validPeriod, entityId } from '../schemas/data-scope.schema.js';
import { readRunData, runTimeseries } from '../services/run-data.service.js';
import { scopedOverview, resolveRunScope } from '../services/stats.service.js';
import { openRouterLimits, openRouterModels } from '../services/openrouter-catalog.service.js';

export async function modelCatalog(_req: Request, res: Response): Promise<void> {
  res.json(await openRouterModels());
}

export async function modelLimits(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await openRouterLimits(requestUserId(req)));
}

export async function provider(req: Request, res: Response): Promise<void> {
  res.json(await publicLlmSettings(requestUserId(req)));
}

export async function saveProvider(req: Request, res: Response): Promise<void> {
  res.json(await updateLlmSettings(requestUserId(req), req.body));
}

export async function checkProvider(req: Request, res: Response): Promise<void> {
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  const provider = await userLlmProvider(requestUserId(req));
  await provider.check(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
  res.json({ ...await publicLlmSettings(requestUserId(req)), available: true });
}

export async function run(req: Request, res: Response): Promise<void> {
  const input = CreateAnalysisRunSchema.parse(req.body ?? {});
  const userId = requestUserId(req);
  await requireOwnedProduct(userId, input.productId);
  const preflight = new AbortController();
  res.once('close', () => { if (!res.writableEnded) preflight.abort(); });
  const settings = await resolveLlmSettings(userId);
  await createProvider(settings.config, true).check(AbortSignal.any([preflight.signal, AbortSignal.timeout(5000)]));
  const created = await createAnalysisRun(userId, input, settings);
  let dispatchPending = false;
  try { await enqueueAnalysisRun(created.id); }
  catch { dispatchPending = true; logger.warn({ runId: created.id }, 'Run committed; queue delivery awaits dispatcher'); }
  res.status(202).json({ ...created, runId: created.id, jobId: created.id, dispatchPending });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const runId = entityId.parse(req.params.runId ?? req.params.jobId);
  const state = await cancelAnalysisRun(runId, requestUserId(req));
  void notifyAnalysisRun(runId);
  res.json({ ...state, ok: true, cancelled: !!state.cancelRequestedAt });
}

export async function retryFailed(req: Request, res: Response): Promise<void> {
  const created = await retryFailedAnalysisRun(entityId.parse(req.params.runId), requestUserId(req));
  let dispatchPending = false;
  try { await enqueueAnalysisRun(created.id); } catch { dispatchPending = true; }
  res.status(202).json({ ...created, jobId: created.id, dispatchPending });
}

export async function getRun(req: Request, res: Response): Promise<void> {
  res.json(await getAnalysisRun(entityId.parse(req.params.runId), requestUserId(req)));
}

export async function listInputs(req: Request, res: Response): Promise<void> {
  res.json(await listAnalysisInputs(entityId.parse(req.params.runId), requestUserId(req), ListAnalysisInputsSchema.parse(req.query)));
}

export async function listRuns(req: Request, res: Response): Promise<void> {
  res.json(await listAnalysisRuns(requestUserId(req), ListAnalysisRunsSchema.parse(req.query)));
}

export async function stats(req: Request, res: Response): Promise<void> {
  const query = DataScopeSchema.parse(req.query);
  res.json(await scopedOverview(requestUserId(req), query));
}

export async function timeseries(req: Request, res: Response): Promise<void> {
  const query = z.object({ ...scopeShape, bucket: z.enum(['day', 'week', 'month']).default('day'),
    days: z.coerce.number().int().min(1).max(365).default(30) }).strict().refine(validPeriod, 'Некорректная область данных').parse(req.query);
  const scope = await resolveRunScope(requestUserId(req), query);
  if (scope.runId) {
    res.json(runTimeseries(await readRunData(requestUserId(req), scope), query.bucket, query.days)); return;
  }
  res.json({ buckets: [], unknownDateCount: null, scope, hasRun: false });
}

export async function aspects(req: Request, res: Response): Promise<void> {
  const query = DataScopeSchema.parse(req.query);
  const data = await readRunData(requestUserId(req), { ...query, runId: entityId.parse(query.runId), productId: entityId.parse(query.productId) });
  res.json({ items: data.aspects, scope: data.scope });
}

export async function summary(req: Request, res: Response): Promise<void> {
  const productId = (req.query.productId as string) || undefined;
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  const text = await generateProductSummary(requestUserId(req), productId, controller.signal);
  res.json({ summary: text });
}
