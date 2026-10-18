import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { createProvider, LlmError, waitForLlm, type CompletionRequest } from '../lib/llm.js';
import { notifyAnalysisRun } from '../lib/analysis-queue.js';
import { AnalysisResultSchema, ANALYSIS_JSON_SCHEMA, ANALYSIS_PROMPT_VERSION } from './analyzer.service.js';
import { ExtractionResultSchema, EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT_VERSION, EXTRACTION_METHOD_VERSION, validateExtractionEvidence } from './extraction.service.js';
import { beginAnalysisInput, claimAnalysisRun, finishAnalysisRun, heartbeatAnalysisRun, saveAnalysisInput } from './analysis-runs.service.js';

const RunConfigurationSchema = z.object({
  provider: z.enum(['local', 'openrouter']), baseUrl: z.string().url(), model: z.string().min(1),
  timeoutMs: z.number().int().positive(), contextTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(), concurrency: z.number().int().min(1).max(8),
  retries: z.number().int().min(0).max(3), retryDelayMs: z.number().int().nonnegative(),
  maxRetryDelayMs: z.number().int().positive(), responseFormat: z.enum(['none', 'json_object', 'json_schema']),
  cloudDelayMs: z.number().int().nonnegative(), webOrigin: z.string().optional(), prompt: z.string().min(1),
}).strict();

export async function processAnalysisRun(runId: string, shutdown?: AbortSignal) {
  const run = await claimAnalysisRun(runId);
  if (!run?.leaseToken) return;
  const token = run.leaseToken;
  const controller = new AbortController();
  const signal = shutdown ? AbortSignal.any([shutdown, controller.signal]) : controller.signal;
  let ticking = false;
  let lostLease = false;
  const heartbeat = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void heartbeatAnalysisRun(runId, token).then((state) => {
      if (!state) { lostLease = true; controller.abort(); }
      else if (state.cancelRequestedAt) controller.abort();
    }).catch(() => { lostLease = true; controller.abort(); }).finally(() => { ticking = false; });
  }, env.ANALYSIS_HEARTBEAT_MS);
  heartbeat.unref();
  void notifyAnalysisRun(runId);
  let finishCode: string | undefined;
  try {
    const structured = run.promptVersion === EXTRACTION_PROMPT_VERSION && run.methodVersion === EXTRACTION_METHOD_VERSION;
    if (!structured && (run.promptVersion !== ANALYSIS_PROMPT_VERSION || run.methodVersion !== 'extraction-v1')) {
      throw new LlmError('invalid_response', 'Версия анализа не поддерживается этим worker');
    }
    const configuration = RunConfigurationSchema.parse(run.settings);
    const provider = createProvider({ ...configuration,
      apiKey: configuration.provider === 'openrouter' ? env.OPENROUTER_API_KEY : undefined,
    }, true);
    const inputs = await prisma.analysisRunReview.findMany({ where: { runId }, orderBy: { id: 'asc' },
      include: { analysis: { select: { status: true } } } });
    for (const input of inputs) {
      if (signal.aborted || lostLease) break;
      if (!await beginAnalysisInput(runId, token, input.id)) continue;
      const start = performance.now();
      try {
        const request: CompletionRequest = {
          messages: [{ role: 'system', content: configuration.prompt },
            { role: 'user', content: `Проанализируй следующий отзыв и верни JSON:\n\n"""\n${input.text}\n"""` }],
          temperature: 0.1, max_tokens: configuration.maxOutputTokens, jsonSchema: structured ? EXTRACTION_JSON_SCHEMA : ANALYSIS_JSON_SCHEMA, schemaName: 'review_analysis',
        };
        const result = structured
          ? validateExtractionEvidence(input.text, await provider.completeJson(request, ExtractionResultSchema, signal))
          : await provider.completeJson(request, AnalysisResultSchema, signal);
        if (signal.aborted) break;
        if (!await saveAnalysisInput(runId, token, input.id,
          { result, durationMs: Math.round(performance.now() - start) })) break;
      } catch (error) {
        if (signal.aborted || lostLease) break;
        const errorCode = error instanceof LlmError ? error.code : 'internal_error';
        if (!await saveAnalysisInput(runId, token, input.id,
          { errorCode, durationMs: Math.round(performance.now() - start) })) break;
      }
      void notifyAnalysisRun(runId);
      if (configuration.provider === 'openrouter') await waitForLlm(configuration.cloudDelayMs, signal);
    }
  } catch (error) {
    finishCode = signal.aborted ? undefined : error instanceof LlmError ? error.code : 'worker_configuration_error';
  } finally {
    clearInterval(heartbeat);
    if (!lostLease) {
      if (shutdown?.aborted) finishCode = 'worker_shutdown';
      await finishAnalysisRun(runId, token, finishCode);
    }
    await notifyAnalysisRun(runId);
  }
}
