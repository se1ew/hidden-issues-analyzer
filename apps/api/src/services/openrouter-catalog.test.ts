import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { encryptApiKey } from './llm-settings.service.js';
import { openRouterLimits, openRouterModels } from './openrouter-catalog.service.js';

const model = (id: string, prompt = '0', completion = '0') => ({ id, name: id, context_length: 32000,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['response_format'],
  endpoints: ['/api/v1/chat/completions'], pricing: { prompt, completion } });
beforeEach(() => { vi.mocked(prisma.userLlmSettings.findUnique).mockResolvedValue(null); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('OpenRouter catalog', () => {
  it('uses actual prices, handles unknown prices and excludes incompatible endpoints/modalities', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [model('paid', '0.000001', '0.000003'), model('free'),
      { ...model('fee'), pricing: { prompt: '0', completion: '0', request: '0.01' } }, model('unknown', '-1'),
      { ...model('image'), architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
      { ...model('batch'), endpoints: ['/api/v1/batches'] }, { ...model('no-json'), supported_parameters: [] }, { id: 'broken' }] })));
    const { items } = await openRouterModels();
    expect(items.map(item => item.id)).toEqual(['free', 'fee', 'paid', 'unknown']);
    expect(items.find(item => item.id === 'paid')).toMatchObject({ isFree: false, pricing: { promptPerMillion: 1, completionPerMillion: 3, request: 0 } });
    expect(items.find(item => item.id === 'fee')?.isFree).toBe(false);
    expect(items.find(item => item.id === 'unknown')).toMatchObject({ isFree: null, pricing: null });
  });
  it('does not treat malformed or empty catalogs as a successful result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'only-broken' }] })));
    await expect(openRouterModels()).rejects.toMatchObject({ status: 503 });
  });
});

describe('OpenRouter limits', () => {
  it('uses each owner’s saved key, sanitizes output and derives the UTC-day reset', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T23:50:00Z'));
    for (const userId of ['a', 'b']) vi.mocked(prisma.userLlmSettings.findUnique).mockResolvedValueOnce({ userId,
      provider: 'openrouter', cloudModel: 'openrouter/free', encryptedKey: encryptApiKey(`private-${userId}`, userId), updatedAt: new Date() });
    const fetcher = vi.fn(async (_url: unknown, options: RequestInit | undefined) => {
      const own = (options?.headers as Record<string, string>).Authorization === 'Bearer private-a';
      return Response.json({ data: { label: 'secret label', free_model_daily_requests: { used: own ? 3 : 8, limit: 37, remaining: own ? 34 : 29 },
        limit: null, limit_remaining: null, rate_limit: { remaining: 9999 } } });
    });
    vi.stubGlobal('fetch', fetcher);
    const a = await openRouterLimits('a'), b = await openRouterLimits('b');
    expect(a.freeRequests).toEqual({ used: 3, limit: 37, remaining: 34, resetAt: '2026-11-05T00:00:00.000Z', resetBasis: 'utc_day' });
    expect(b.freeRequests?.remaining).toBe(29);
    expect(a.keyCredits).toEqual({ limit: null, remaining: null, reset: null });
    expect(JSON.stringify(a)).not.toMatch(/private|secret|9999/);
    expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/key$/), expect.objectContaining({ redirect: 'error' }));
  });
  it('never borrows the installation key for an account with no saved key', async () => {
    vi.mocked(prisma.userLlmSettings.findUnique).mockResolvedValue({ userId: 'a', provider: 'local', cloudModel: null, encryptedKey: null, updatedAt: new Date() });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(openRouterLimits('a')).rejects.toMatchObject({ status: 409, code: 'openrouter_key_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([undefined, { used: 3, limit: 50, remaining: 90 }, { used: '3', limit: 50, remaining: 47 }])('reports missing or invalid counters as unknown: %j', async counter => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: { free_model_daily_requests: counter, usage_daily: 0.2, rate_limit: { remaining: 40 } } })));
    expect(await openRouterLimits('a')).toMatchObject({ freeRequests: null, keyCredits: null });
  });
  it('keeps dollar spending caps separate from request counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: { limit: 10, limit_remaining: 4.5, limit_reset: 'monthly' } })));
    expect(await openRouterLimits('a')).toMatchObject({ freeRequests: null, keyCredits: { limit: 10, remaining: 4.5, reset: 'monthly' } });
  });
  it.each([401, 429, 500])('returns a safe error for provider HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private-key and private data', { status })));
    await expect(openRouterLimits('a')).rejects.toMatchObject({ status: 503, code: 'openrouter_unavailable' });
    await expect(openRouterLimits('a')).rejects.not.toThrow(/private/);
  });
  it('sanitizes network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('secret URL and key'); }));
    await expect(openRouterLimits('a')).rejects.toThrow('Сведения OpenRouter временно недоступны');
  });
});
