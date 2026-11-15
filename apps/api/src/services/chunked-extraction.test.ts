import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createProvider, LlmError, type LlmProvider } from '../lib/llm.js';
import { extractReview, extractionCacheKey, splitReview } from './chunked-extraction.service.js';
import { EXTRACTION_PROMPT_VERSION, EXTRACTION_METHOD_VERSION, prepareExtraction } from './extraction.service.js';

const cache = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { extractionCache: cache } }));
const config = { provider: 'local' as const, baseUrl: 'http://localhost/v1', model: 'fixture', timeoutMs: 1000,
  contextTokens: 2048, maxOutputTokens: 512, concurrency: 1, retries: 0, retryDelayMs: 0,
  maxRetryDelayMs: 1000, responseFormat: 'json_object' as const, cloudDelayMs: 0 };
const input = { userId: 'a', text: 'Крышка заедает.', prompt: 'Извлеки жалобы.',
  promptVersion: EXTRACTION_PROMPT_VERSION, methodVersion: EXTRACTION_METHOD_VERSION, modelVersion: 'sha:123' };
beforeEach(() => { vi.clearAllMocks(); cache.findUnique.mockResolvedValue(null); });

describe('bounded extraction and revision cache', () => {
  it('uses the stable scoped wire format but assigns authoritative scope from the aspect on the server', async () => {
    const completeJson = vi.fn(async (request, schema) => {
      const properties = request.jsonSchema.properties.aspects.items.properties.complaints.items.properties;
      expect(properties).toHaveProperty('scope');
      return schema.parse({ sentiment: 'negative', sentiment_score: -0.5, aspects: [{ name: 'упаковка', sentiment: 'negative',
        complaints: [{ scope: 'product', description: 'помята коробка', evidenceId: 0, consequenceId: null, assertion: 'experienced' }] }] });
    });
    const result = await extractReview({ ...input, text: 'Коробка помята.' }, { config, completeJson } as unknown as LlmProvider);
    expect(result.complaints[0]).toMatchObject({ scope: 'packaging', quote: 'Коробка помята.' });
  });
  const valid = { sentiment: 'negative' as const, sentiment_score: -0.5,
    aspects: [{ name: 'качество', sentiment: 'negative' as const }],
    complaints: [{ aspectIndex: 0, scope: 'product' as const, description: 'заедание', quote: 'Крышка заедает.', assertion: 'experienced' as const, consequences: null }] };
  it('repairs evidence once against the original text and caches only the validated result', async () => {
    const completeJson = vi.fn().mockResolvedValueOnce({ ...valid, complaints: [{ ...valid.complaints[0], quote: 'крышка заедает.' }] }).mockResolvedValueOnce(valid);
    const metrics = { chunks: 0, cacheHit: false, usage: {}, responses: 0, repairs: 0 };
    const result = await extractReview(input, { config, completeJson } as unknown as LlmProvider, undefined, metrics);
    expect(result.complaints[0]).toMatchObject({ quoteStart: 0, quoteEnd: input.text.length });
    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(completeJson.mock.calls[1][0]).toMatchObject({ disableRetries: true });
    expect(completeJson.mock.calls[1][0].messages[1].content).toContain(input.text);
    expect(metrics.repairs).toBe(1);
    expect(cache.upsert).toHaveBeenCalledOnce();
  });
  it('rejects a second invalid response without caching or further requests', async () => {
    const completeJson = vi.fn().mockRejectedValue(new LlmError('invalid_response', 'bad JSON'));
    await expect(extractReview(input, { config, completeJson } as unknown as LlmProvider)).rejects.toMatchObject({ code: 'invalid_response' });
    expect(completeJson).toHaveBeenCalledTimes(2); expect(cache.upsert).not.toHaveBeenCalled();
  });
  it.each(['network', 'timeout', 'http', 'cancelled'] as const)('does not repair %s failures', async code => {
    const completeJson = vi.fn().mockRejectedValue(new LlmError(code, 'unavailable'));
    await expect(extractReview(input, { config, completeJson } as unknown as LlmProvider)).rejects.toMatchObject({ code });
    expect(completeJson).toHaveBeenCalledOnce();
  });
  it('honors cancellation before the repair request', async () => {
    const controller = new AbortController();
    const completeJson = vi.fn(async () => { controller.abort(); throw new LlmError('invalid_response', 'bad'); });
    await expect(extractReview(input, { config, completeJson } as unknown as LlmProvider, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(completeJson).toHaveBeenCalledOnce(); expect(cache.upsert).not.toHaveBeenCalled();
  });
  it('does not silently resolve ambiguous repeated evidence', async () => {
    const completeJson = vi.fn().mockResolvedValue(valid);
    await expect(extractReview({ ...input, text: input.text.repeat(2) }, { config, completeJson } as unknown as LlmProvider)).rejects.toMatchObject({ code: 'invalid_evidence' });
    expect(completeJson).toHaveBeenCalledTimes(2); expect(cache.upsert).not.toHaveBeenCalled();
  });
  it.each(['extraction-v4', 'extraction-v5'])('does not add repair to historical %s runs', async methodVersion => {
    const completeJson = vi.fn().mockRejectedValue(new LlmError('invalid_evidence', 'bad'));
    await expect(extractReview({ ...input, methodVersion }, { config, completeJson } as unknown as LlmProvider)).rejects.toMatchObject({ code: 'invalid_evidence' });
    expect(completeJson).toHaveBeenCalledOnce();
  });
  it('disables transport retries for a bounded repair request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(createProvider({ ...config, retries: 2 }).complete({ messages: [{ role: 'user', content: 'test' }], disableRetries: true })).rejects.toMatchObject({ code: 'http' });
      expect(fetch).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps the flat wire contract for previously queued extraction-v4 runs', async () => {
    const legacy = { sentiment: 'neutral', sentiment_score: 0, aspects: [], complaints: [] };
    const completeJson = vi.fn(async (request, schema) => {
      expect(request.jsonSchema.properties).toHaveProperty('complaints');
      expect(schema.safeParse(legacy).success).toBe(true);
      return legacy;
    });
    await extractReview({ ...input, promptVersion: 'review-evidence-v3', methodVersion: 'extraction-v4', modelVersion: 'unverified' },
      { config, completeJson } as unknown as LlmProvider);
    expect(completeJson).toHaveBeenCalledOnce();
  });
  it('covers every original code unit and preserves emoji at chunk boundaries', () => {
    const text = 'Текст 😀 о товаре. '.repeat(200);
    const chunks = splitReview(text, 768);
    let end = 0;
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk.text)).toBeLessThanOrEqual(768);
      expect(text.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
      expect(chunk.start).toBeLessThanOrEqual(end);
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      end = chunk.start + chunk.text.length;
    }
    expect(end).toBe(text.length);
    expect(chunks.reduce((sum, chunk) => sum + chunk.weight, 0)).toBe(text.length);
  });
  it('extracts the final complaint, records usage and translates offsets to the full source', async () => {
    const text = 'Нормальный товар. '.repeat(190) + 'Крышка заедает.';
    const provider = { config, completeJson: vi.fn(async (request) => {
      request.onUsage?.({ promptTokens: 30, completionTokens: 10, totalTokens: 40 });
      const found = request.messages[1].content.includes('Крышка заедает.');
      return { sentiment: 'positive', sentiment_score: 0.6,
        aspects: [{ name: 'качество', sentiment: 'negative' }],
        complaints: found ? [{ aspectIndex: 0, scope: 'product', description: 'заедание',
          quote: 'Крышка заедает.', assertion: 'experienced', consequences: null }] : [] };
    }) } as unknown as LlmProvider;
    const metrics = { chunks: 0, cacheHit: false, usage: {}, responses: 0 };
    const result = await extractReview({ ...input, text }, provider, undefined, metrics);
    const prepared = prepareExtraction(text, 5, result);
    expect(metrics.chunks).toBeGreaterThan(1);
    expect(metrics.usage).toEqual({ promptTokens: metrics.chunks * 30, completionTokens: metrics.chunks * 10, totalTokens: metrics.chunks * 40 });
    expect(prepared.complaints).toHaveLength(1);
    expect(prepared.complaints[0].quoteEnd).toBe(text.length);
    expect(text.slice(prepared.complaints[0].quoteStart, prepared.complaints[0].quoteEnd)).toBe('Крышка заедает.');
    expect(cache.upsert).toHaveBeenCalledOnce();
  });
  it('reuses only a validated nonexpired entry within the owner and exact settings', async () => {
    const result = { sentiment: 'neutral', sentiment_score: 0, aspects: [], complaints: [] };
    const provider = { config, completeJson: vi.fn() } as unknown as LlmProvider;
    cache.findUnique.mockResolvedValue({ result, expiresAt: new Date(Date.now() + 10000) });
    const metrics = { chunks: 0, cacheHit: false, usage: {}, responses: 0 };
    expect(await extractReview(input, provider, undefined, metrics)).toEqual(result);
    expect(metrics.cacheHit).toBe(true);
    expect(provider.completeJson).not.toHaveBeenCalled();
    const key = extractionCacheKey(input, provider);
    for (const change of [{ userId: 'b' }, { prompt: 'changed' }, { modelVersion: 'sha:456' }, { text: 'Другой отзыв' }]) {
      expect(extractionCacheKey({ ...input, ...change }, provider)).not.toBe(key);
    }
    expect(extractionCacheKey(input, { ...provider, config: { ...config, maxOutputTokens: 256 } })).not.toBe(key);
  });
  it('never caches an unknown model revision or cancelled result', async () => {
    const provider = { config, completeJson: vi.fn().mockResolvedValue({ sentiment: 'neutral', sentiment_score: 0, aspects: [], complaints: [] }) } as unknown as LlmProvider;
    await extractReview({ ...input, modelVersion: 'unverified' }, provider);
    expect(cache.findUnique).not.toHaveBeenCalled(); expect(cache.upsert).not.toHaveBeenCalled();
    await expect(extractReview(input, provider, AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' });
    expect(provider.completeJson).toHaveBeenCalledTimes(1);
  });
  it('collects actual token usage through the HTTP provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      usage: { prompt_tokens: 21, completion_tokens: 3, total_tokens: 24 },
    }))));
    try {
      const onUsage = vi.fn();
      expect(await createProvider(config).complete({ messages: [{ role: 'user', content: 'test' }], onUsage })).toBe('ok');
      expect(onUsage).toHaveBeenCalledWith({ promptTokens: 21, completionTokens: 3, totalTokens: 24 });
    } finally { vi.unstubAllGlobals(); }
  });
});
