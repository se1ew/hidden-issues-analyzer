import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { createProvider, LlmError, waitForLlm, type CompletionRequest } from '../lib/llm.js';
import { notifyAnalysisRun } from '../lib/analysis-queue.js';
import { AnalysisResultSchema, ANALYSIS_JSON_SCHEMA, ANALYSIS_PROMPT_VERSION } from './analyzer.service.js';
import { ExtractionResultSchema, EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT_VERSION, EXTRACTION_METHOD_VERSION, validateExtractionEvidence } from './extraction.service.js';
import { beginAnalysisInput, claimAnalysisRun, finishAnalysisRun, heartbeatAnalysisRun, saveAnalysisInput, markGroupingStage } from './analysis-runs.service.js';
import { GroupingSettingsSchema } from '../schemas/grouping.schema.js';
import { EmbeddingConfigurationSchema } from '../schemas/embedding.schema.js';
import { prepareRunGrouping, type GroupingPlan } from './clustering.service.js';
import { extractReview, CHUNKING_VERSION } from './chunked-extraction.service.js';
import type { TokenUsage } from '../lib/llm.js';
import { runApiKey } from './llm-settings.service.js';
import { logger } from '../lib/logger.js';

export const RunConfigurationSchema = z.object({
  provider: z.enum(['local', 'openrouter']), baseUrl: z.string().url(), model: z.string().min(1),
  timeoutMs: z.number().int().positive(), contextTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(), concurrency: z.number().int().min(1).max(8),
  retries: z.number().int().min(0).max(3), retryDelayMs: z.number().int().nonnegative(),
  maxRetryDelayMs: z.number().int().positive(), responseFormat: z.enum(['none', 'json_object', 'json_schema']),
  cloudDelayMs: z.number().int().nonnegative(), webOrigin: z.string().optional(), prompt: z.string().min(1),
  credentialSource: z.literal('account').optional(),
  grouping: GroupingSettingsSchema.optional(), embedding: EmbeddingConfigurationSchema.optional(),
}).strict();

async function retryRunDatabase<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      // These errors roll back the transaction, so repeating the fenced write
      // cannot duplicate results or require another model request.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)
        || !['P2024', 'P2028', 'P2034'].includes(error.code) || attempt >= 1 || signal.aborted) throw error;
      await waitForLlm(250, signal);
    }
  }
}

export async function processAnalysisRun(runId: string, shutdown?: AbortSignal) {
  const run = await claimAnalysisRun(runId);
  if (!run?.leaseToken) return;
  const token = run.leaseToken;
  const controller = new AbortController();
  const signal = shutdown ? AbortSignal.any([shutdown, controller.signal]) : controller.signal;
  let ticking = false;
  let lostLease = false;
  let leaseDeadline = run.leaseExpiresAt?.getTime() ?? Date.now() + env.ANALYSIS_LEASE_MS;
  const heartbeat = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void heartbeatAnalysisRun(runId, token).then((state) => {
      if (!state) { lostLease = true; controller.abort(); }
      else if (state.cancelRequestedAt) controller.abort();
      else if (state.leaseExpiresAt) leaseDeadline = state.leaseExpiresAt.getTime();
    }).catch((error) => {
      logger.warn({ runId, databaseCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined }, 'Analysis heartbeat temporarily unavailable');
      if (Date.now() >= leaseDeadline) { lostLease = true; controller.abort(); }
    }).finally(() => { ticking = false; });
  }, env.ANALYSIS_HEARTBEAT_MS);
  heartbeat.unref();
  void notifyAnalysisRun(runId);
  let finishCode: string | undefined;
  let groupingPlan: GroupingPlan | undefined;
  let phase = 'configuration';
  try {
    const structured = (run.promptVersion === EXTRACTION_PROMPT_VERSION && run.methodVersion === EXTRACTION_METHOD_VERSION)
      || (run.promptVersion === 'review-evidence-v3' && run.methodVersion === 'extraction-v3')
      || (run.promptVersion === 'review-evidence-v2' && run.methodVersion === 'extraction-v2');
    if (!structured && (run.promptVersion !== ANALYSIS_PROMPT_VERSION || run.methodVersion !== 'extraction-v1')) {
      throw new LlmError('invalid_response', 'Версия анализа не поддерживается этим worker');
    }
    const configuration = RunConfigurationSchema.parse(run.settings);
    phase = 'credentials';
    const apiKey = configuration.provider === 'openrouter' ? await runApiKey(run.userId, configuration.credentialSource) : undefined;
    phase = 'provider';
    const provider = createProvider({ ...configuration,
      apiKey,
    }, true);
    phase = 'inputs';
    const inputs = await prisma.analysisRunReview.findMany({ where: { runId }, orderBy: { id: 'asc' },
      include: { analysis: { select: { status: true } } } });
    phase = 'extraction';
    for (const input of inputs) {
      phase = 'extraction';
      if (signal.aborted || lostLease) break;
      if (!await retryRunDatabase(() => beginAnalysisInput(runId, token, input.id), signal)) continue;
      const start = performance.now();
      const metrics = { chunks: 0, cacheHit: false, usage: {} as TokenUsage, responses: 0 };
      const execution = () => ({ chunks: metrics.chunks, cacheHit: metrics.cacheHit,
        usageResponses: metrics.responses, chunkingVersion: CHUNKING_VERSION,
        sentimentAggregation: metrics.chunks > 1 ? 'nonoverlap_length_weighted_score' : 'model',
      });
      let outcome: Parameters<typeof saveAnalysisInput>[3];
      try {
        const request: CompletionRequest = {
          messages: [{ role: 'system', content: configuration.prompt },
            { role: 'user', content: `Проанализируй следующий отзыв и верни JSON:\n\n"""\n${input.text}\n"""` }],
          temperature: 0.1, max_tokens: configuration.maxOutputTokens, jsonSchema: structured ? EXTRACTION_JSON_SCHEMA : ANALYSIS_JSON_SCHEMA, schemaName: 'review_analysis',
        };
        const result = run.methodVersion === EXTRACTION_METHOD_VERSION ? await extractReview({
          userId: run.userId, text: input.text, prompt: configuration.prompt, promptVersion: run.promptVersion,
          methodVersion: run.methodVersion, modelVersion: run.modelVersion ?? 'unverified',
        }, provider, signal, metrics) : structured
          ? validateExtractionEvidence(input.text, await provider.completeJson(request, ExtractionResultSchema, signal))
          : await provider.completeJson(request, AnalysisResultSchema, signal);
        if (signal.aborted) break;
        outcome = { result, durationMs: Math.round(performance.now() - start), tokenUsage: { ...metrics.usage }, execution: execution() };
      } catch (error) {
        if (signal.aborted || lostLease) break;
        const errorCode = error instanceof LlmError ? error.code : 'internal_error';
        outcome = { errorCode, durationMs: Math.round(performance.now() - start), tokenUsage: { ...metrics.usage },
          execution: { ...execution(), ...(error instanceof LlmError && error.status ? { providerHttpStatus: error.status } : {}) } };
      }
      phase = 'persistence';
      if (!await retryRunDatabase(() => saveAnalysisInput(runId, token, input.id, outcome), signal)) break;
      void notifyAnalysisRun(runId);
      if (configuration.provider === 'openrouter') await waitForLlm(configuration.cloudDelayMs, signal);
    }
    if (configuration.grouping && !signal.aborted && !lostLease && await markGroupingStage(runId, token)) {
      phase = 'grouping';
      void notifyAnalysisRun(runId);
      try { groupingPlan = await prepareRunGrouping(runId, signal); }
      catch { if (!signal.aborted) finishCode = 'grouping_failed'; }
    }
  } catch (error) {
    const reason = error instanceof Error && error.message === 'Для OpenRouter нужен настоящий API-ключ' ? 'missing_api_key'
      : error instanceof Error && error.message === 'Не удалось прочитать ключ OpenRouter. Сохраните ключ заново в профиле.' ? 'key_decryption_failed' : undefined;
    logger.error({ runId, phase, reason, errorType: error instanceof Error ? error.name : 'unknown',
      errorCode: error instanceof LlmError ? error.code : undefined,
      databaseCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
      validation: error instanceof z.ZodError ? error.issues.map(issue => ({ code: issue.code, path: issue.path })) : undefined,
    }, 'Analysis run failed before completion');
    finishCode = signal.aborted ? undefined : error instanceof LlmError ? error.code
      : error instanceof Prisma.PrismaClientKnownRequestError ? 'database_error'
      : ['configuration', 'credentials', 'provider'].includes(phase) ? 'worker_configuration_error' : 'worker_error';
  } finally {
    clearInterval(heartbeat);
    if (!lostLease) {
      if (shutdown?.aborted) finishCode = 'worker_shutdown';
      await finishAnalysisRun(runId, token, finishCode, groupingPlan);
    }
    await notifyAnalysisRun(runId);
  }
}
