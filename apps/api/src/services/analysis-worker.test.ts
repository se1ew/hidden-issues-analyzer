import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { EXTRACTION_METHOD_VERSION, EXTRACTION_PROMPT_VERSION } from './extraction.service.js';
import { processAnalysisRun, RunConfigurationSchema } from './analysis-worker.service.js';
import { logger } from '../lib/logger.js';

const mocks = vi.hoisted(() => ({ claim: vi.fn(), begin: vi.fn(), save: vi.fn(), finish: vi.fn(),
  heartbeat: vi.fn(), inputs: vi.fn(), complete: vi.fn(), notify: vi.fn() }));
vi.mock('./analysis-runs.service.js', () => ({
  claimAnalysisRun: mocks.claim, beginAnalysisInput: mocks.begin, saveAnalysisInput: mocks.save,
  finishAnalysisRun: mocks.finish, heartbeatAnalysisRun: mocks.heartbeat,
}));
vi.mock('../lib/prisma.js', () => ({ prisma: { analysisRunReview: { findMany: mocks.inputs } } }));
vi.mock('../lib/analysis-queue.js', () => ({ notifyAnalysisRun: mocks.notify }));
vi.mock('../lib/llm.js', async (original) => ({ ...await original<typeof import('../lib/llm.js')>(),
  createProvider: (config: unknown) => ({ config, completeJson: mocks.complete }),
}));

const result = { sentiment: 'positive', sentiment_score: 0.5, aspects: [], complaints: [] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue({ leaseToken: 'lease', promptVersion: EXTRACTION_PROMPT_VERSION, methodVersion: EXTRACTION_METHOD_VERSION,
    settings: { provider: 'local', baseUrl: 'http://localhost:8080/v1', model: 'fixture', prompt: 'saved prompt',
      timeoutMs: 5000, contextTokens: 4096, maxOutputTokens: 1024, concurrency: 1, retries: 0,
      retryDelayMs: 0, maxRetryDelayMs: 1000, responseFormat: 'json_object', cloudDelayMs: 0 } });
  mocks.inputs.mockResolvedValue([{ id: 'first', text: 'Первый' }, { id: 'second', text: 'Второй' }, { id: 'third', text: 'Третий' }]);
  mocks.begin.mockResolvedValue(true); mocks.save.mockResolvedValue(true);
  mocks.complete.mockResolvedValue(result);
});
afterEach(() => vi.useRealTimers());

describe('worker shutdown and durable result boundary', () => {
  it('retries a rolled-back database write without generating the same review again', async () => {
    mocks.save.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('private database detail', { code: 'P2028', clientVersion: '5.22.0' }));
    await processAnalysisRun('run');
    expect(mocks.complete).toHaveBeenCalledTimes(3);
    expect(mocks.save).toHaveBeenCalledTimes(4);
    expect(mocks.save.mock.calls[0][3]).toHaveProperty('result');
    expect(mocks.save.mock.calls[1][3]).toHaveProperty('result');
    expect(mocks.finish).toHaveBeenCalledWith('run', 'lease', undefined, undefined);
  });
  it('distinguishes a persistent database failure from model configuration', async () => {
    mocks.begin.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('private database detail', { code: 'P2028', clientVersion: '5.22.0' }));
    await processAnalysisRun('run');
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith('run', 'lease', 'database_error', undefined);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ databaseCode: 'P2028' }), expect.any(String));
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('private database detail');
  });
  it('retains the run after one failed heartbeat while its lease is still valid', async () => {
    vi.useFakeTimers();
    mocks.inputs.mockResolvedValue([{ id: 'first', text: 'Первый' }]);
    mocks.heartbeat.mockRejectedValueOnce(new Error('temporary database failure'))
      .mockImplementation(async () => ({ leaseExpiresAt: new Date(Date.now() + 30_000) }));
    let currentSignal: AbortSignal | undefined;
    let finishResponse!: (value: typeof result) => void;
    mocks.complete.mockImplementation((_request, _schema, signal) => {
      currentSignal = signal;
      return new Promise(resolve => { finishResponse = resolve; });
    });
    const processing = processAnalysisRun('run');
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.heartbeat).toHaveBeenCalledTimes(1);
    expect(currentSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.heartbeat).toHaveBeenCalledTimes(2);
    expect(currentSignal?.aborted).toBe(false);
    finishResponse(result); await processing;
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith('run', 'lease', undefined, undefined);
  });
  it('stops without writing when heartbeats keep failing until the lease expires', async () => {
    vi.useFakeTimers();
    const run = await mocks.claim(); run.leaseExpiresAt = new Date(Date.now() + 1500);
    mocks.inputs.mockResolvedValue([{ id: 'first', text: 'Первый' }]);
    mocks.heartbeat.mockRejectedValue(new Error('database still unavailable'));
    mocks.complete.mockImplementation((_request, _schema, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const processing = processAnalysisRun('run');
    await vi.advanceTimersByTimeAsync(2000); await processing;
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });
  it('accepts the complete account configuration saved by the API', () => {
    expect(RunConfigurationSchema.safeParse({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free', credentialSource: 'account', prompt: 'saved prompt', timeoutMs: 300000,
      contextTokens: 4096, maxOutputTokens: 1024, concurrency: 1, retries: 2, retryDelayMs: 500,
      maxRetryDelayMs: 5000, responseFormat: 'json_schema', cloudDelayMs: 4000, webOrigin: 'http://localhost:4000',
      grouping: { version: 'dbscan-complete-link-v1', epsilon: 0.25, minReviews: 2, maxMentions: 1000, representatives: 4 },
      embedding: { model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', revision: '2c4055b12046f11709e9df2c122e59ffbdc2f900',
        method: 'quantized-mean-l2-v1', batchSize: 16 },
    }).success).toBe(true);
  });
  it('logs validation paths without logging saved prompts or settings', async () => {
    const run = await mocks.claim(); run.settings.timeoutMs = 'invalid-private-value';
    await processAnalysisRun('run');
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run', phase: 'configuration', errorType: 'ZodError',
      validation: expect.arrayContaining([expect.objectContaining({ path: ['timeoutMs'] })]),
    }), 'Analysis run failed before completion');
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toMatch(/invalid-private-value|saved prompt/);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('aborts the active request, retains saved work and starts no further inputs', async () => {
    const shutdown = new AbortController();
    mocks.complete.mockResolvedValueOnce(result).mockImplementationOnce(async (_request, _schema, signal: AbortSignal) => {
      shutdown.abort();
      expect(signal.aborted).toBe(true);
      throw new Error('aborted provider request');
    });
    await processAnalysisRun('run', shutdown.signal);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.begin).toHaveBeenCalledTimes(2);
    expect(mocks.finish).toHaveBeenCalledWith('run', 'lease', 'worker_shutdown', undefined);
  });
  it('rejects a late successful response after shutdown', async () => {
    const shutdown = new AbortController();
    mocks.complete.mockImplementationOnce(async () => { shutdown.abort(); return result; });
    await processAnalysisRun('run', shutdown.signal);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.begin).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith('run', 'lease', 'worker_shutdown', undefined);
  });
  it('does not execute duplicate deliveries that cannot claim the database lease', async () => {
    mocks.claim.mockResolvedValue(null);
    await processAnalysisRun('run');
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });
});
