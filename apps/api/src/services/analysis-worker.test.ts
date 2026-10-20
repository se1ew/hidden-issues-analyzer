import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTRACTION_METHOD_VERSION, EXTRACTION_PROMPT_VERSION } from './extraction.service.js';
import { processAnalysisRun } from './analysis-worker.service.js';

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

describe('worker shutdown and durable result boundary', () => {
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
