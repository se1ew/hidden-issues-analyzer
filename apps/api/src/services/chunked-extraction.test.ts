import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createProvider, type LlmProvider } from '../lib/llm.js';
import { extractReview, extractionCacheKey, splitReview } from './chunked-extraction.service.js';
import { EXTRACTION_PROMPT_VERSION, EXTRACTION_METHOD_VERSION, prepareExtraction } from './extraction.service.js';

const cache = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { extractionCache: cache } }));
const config = { provider: 'local' as const, baseUrl: 'http://localhost/v1', model: 'fixture', timeoutMs: 1000,
  contextTokens: 1024, maxOutputTokens: 512, concurrency: 1, retries: 0, retryDelayMs: 0,
  maxRetryDelayMs: 1000, responseFormat: 'json_object' as const, cloudDelayMs: 0 };
const input = { userId: 'a', text: 'Крышка заедает.', prompt: 'Извлеки жалобы.',
  promptVersion: EXTRACTION_PROMPT_VERSION, methodVersion: EXTRACTION_METHOD_VERSION, modelVersion: 'sha:123' };
beforeEach(() => { vi.clearAllMocks(); cache.findUnique.mockResolvedValue(null); });

describe('bounded extraction and revision cache', () => {
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
