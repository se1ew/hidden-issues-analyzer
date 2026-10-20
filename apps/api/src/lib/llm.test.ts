import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createProvider, type ProviderConfig } from './llm.js';
import { AnalysisResultSchema, ANALYSIS_JSON_SCHEMA } from '../services/analyzer.service.js';

const servers: Server[] = [];
const result = { sentiment: 'positive', sentiment_score: 0.6,
  aspects: [{ name: 'качество', sentiment: 'positive' }], issues: ['давит оголовье'] };
const request = { messages: [{ role: 'user' as const, content: 'Звук отличный, но давит оголовье.' }],
  jsonSchema: ANALYSIS_JSON_SCHEMA, schemaName: 'review_analysis' };
const envelope = (content: unknown = result) => ({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });

async function fixture(handler: (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) => void | Promise<void>) {
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk.toString();
    await handler(req, res, raw ? JSON.parse(raw) as Record<string, unknown> : {});
  });
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${port}/v1`;
}
function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
}
function config(baseUrl: string, patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return { provider: 'local', baseUrl, model: 'test-model', timeoutMs: 1000, contextTokens: 8192,
    maxOutputTokens: 1024, concurrency: 1, retries: 1, retryDelayMs: 1,
    maxRetryDelayMs: 20, responseFormat: 'json_object', cloudDelayMs: 4000, ...patch };
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('local and OpenRouter HTTP adapters', () => {
  it.each(['local', 'openrouter'] as const)('%s uses the same validated contract and never changes endpoints', async (provider) => {
    const paths: string[] = [];
    const cases = [result, { sentiment: 'positive', sentiment_score: 0.8, aspects: [], issues: [] },
      { sentiment: 'negative', sentiment_score: -0.7, aspects: [{ name: 'доставка', sentiment: 'negative' }], issues: ['коробка повреждена'] }];
    let completionIndex = 0;
    const base = await fixture((req, res, body) => {
      paths.push(req.url!);
      expect(req.headers.authorization).toBe(provider === 'openrouter' ? 'Bearer test-only-key' : undefined);
      if (req.url === '/v1/models') return json(res, { data: [{ id: 'test-model' }] });
      expect(body.model).toBe('test-model'); expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages).toEqual(request.messages);
      json(res, envelope(cases[completionIndex++]));
    });
    const adapter = createProvider(config(base, { provider, apiKey: 'test-only-key' }));
    await adapter.check();
    for (const expected of cases) expect(await adapter.completeJson(request, AnalysisResultSchema)).toEqual(expected);
    expect(paths).toEqual(['/v1/models', '/v1/chat/completions', '/v1/chat/completions', '/v1/chat/completions']);
  });

  it.each(['none', 'json_object', 'json_schema'] as const)('supports explicit response_format=%s', async (responseFormat) => {
    let body: Record<string, unknown> = {};
    const base = await fixture((_req, res, value) => { body = value; json(res, envelope()); });
    await createProvider(config(base, { responseFormat })).completeJson(request, AnalysisResultSchema);
    if (responseFormat === 'none') expect(body.response_format).toBeUndefined();
    if (responseFormat === 'json_object') expect(body.response_format).toEqual({ type: 'json_object' });
    if (responseFormat === 'json_schema') expect(body.response_format).toEqual({ type: 'json_schema',
      json_schema: { name: 'review_analysis', strict: true, schema: ANALYSIS_JSON_SCHEMA } });
  });

  it('does not require JSON mode for free-text summaries', async () => {
    const base = await fixture((_req, res, body) => {
      expect(body.response_format).toBeUndefined();
      json(res, { choices: [{ message: { content: 'Краткая сводка' }, finish_reason: 'stop' }] });
    });
    expect(await createProvider(config(base)).complete({ messages: request.messages })).toBe('Краткая сводка');
  });

  it('reports a missing model without starting inference', async () => {
    let calls = 0;
    const base = await fixture((_req, res) => { calls++; json(res, { data: [{ id: 'other-model' }] }); });
    await expect(createProvider(config(base)).check()).rejects.toMatchObject({ code: 'model_unavailable' });
    expect(calls).toBe(1);
  });

  it('retries a temporary HTTP failure within its limit', async () => {
    let calls = 0;
    const base = await fixture((_req, res) => { calls++; json(res, calls === 1 ? {} : envelope(), calls === 1 ? 503 : 200); });
    expect(await createProvider(config(base)).completeJson(request, AnalysisResultSchema)).toEqual(result);
    expect(calls).toBe(2);
  });

  it.each([400, 401, 403, 404])('does not retry permanent HTTP %s or expose the provider body', async (status) => {
    let calls = 0;
    const base = await fixture((_req, res) => { calls++; json(res, { secret: 'RAW_PROVIDER_SECRET' }, status); });
    await expect(createProvider(config(base)).complete(request)).rejects.toMatchObject({ code: 'http', status,
      message: `Модель вернула HTTP ${status}` });
    expect(calls).toBe(1);
  });

  it('does not ignore a long Retry-After or infer through another provider', async () => {
    let calls = 0;
    const base = await fixture((_req, res) => { calls++; res.setHeader('Retry-After', '999'); json(res, {}, 429); });
    await expect(createProvider(config(base)).complete(request)).rejects.toMatchObject({ code: 'http', status: 429 });
    expect(calls).toBe(1);
  });

  it('retries invalid output with a bounded attempt count', async () => {
    let calls = 0;
    const base = await fixture((_req, res) => { calls++; json(res, envelope({ ...result, sentiment: 'invented' })); });
    await expect(createProvider(config(base, { retries: 2 })).completeJson(request, AnalysisResultSchema))
      .rejects.toMatchObject({ code: 'invalid_response' });
    expect(calls).toBe(3);
  });

  it('recovers from a malformed JSON generation without coercing fields', async () => {
    let calls = 0;
    const base = await fixture((_req, res) => {
      calls++;
      json(res, calls === 1 ? { choices: [{ message: { content: 'not-json' }, finish_reason: 'stop' }] } : envelope());
    });
    expect(await createProvider(config(base)).completeJson(request, AnalysisResultSchema)).toEqual(result);
    expect(calls).toBe(2);
  });

  it.each(['length', 'content_filter'])('rejects unfinished or filtered generation: %s', async (reason) => {
    const base = await fixture((_req, res) => json(res, { choices: [{ message: { content: JSON.stringify(result) }, finish_reason: reason }] }));
    await expect(createProvider(config(base, { retries: 0 })).completeJson(request, AnalysisResultSchema))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('recognizes an out-of-memory response without exposing provider text', async () => {
    const base = await fixture((_req, res) => { res.statusCode = 500; res.end('CUDA out of memory: secret-review-text'); });
    try { await createProvider(config(base)).complete(request); throw new Error('expected failure'); }
    catch (error) { expect(error).toMatchObject({ code: 'resource_exhausted' }); expect(String(error)).not.toContain('secret-review-text'); }
  });
  it('distinguishes timeout from explicit cancellation', async () => {
    const base = await fixture(async (_req, res) => { await delay(100); json(res, envelope()); });
    const adapter = createProvider(config(base, { timeoutMs: 20, retries: 0 }));
    await expect(adapter.complete(request)).rejects.toMatchObject({ code: 'timeout' });
    const controller = new AbortController(); controller.abort();
    await expect(adapter.complete(request, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('aborts an active request without retrying it', async () => {
    let started!: () => void;
    const reached = new Promise<void>((resolve) => { started = resolve; }); let calls = 0;
    const base = await fixture(async (_req, res) => { calls++; started(); await delay(80); json(res, envelope()); });
    const controller = new AbortController();
    const pending = createProvider(config(base)).complete(request, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await reached; controller.abort(); await rejected;
    expect(calls).toBe(1);
  });

  it('enforces one shared concurrency limit and removes cancelled waiters', async () => {
    let active = 0, peak = 0, calls = 0;
    const base = await fixture(async (_req, res) => {
      calls++; active++; peak = Math.max(peak, active); await delay(30); active--; json(res, envelope());
    });
    const adapter = createProvider(config(base));
    const first = adapter.complete(request);
    const controller = new AbortController(); const waiting = adapter.complete(request, controller.signal);
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort(); await rejected;
    await Promise.all([first, adapter.complete(request), adapter.complete(request)]);
    expect(peak).toBe(1); expect(calls).toBe(3);
  });

  it('never silently truncates input and rejects excess before HTTP', async () => {
    let calls = 0; const text = 'а'.repeat(4000);
    const base = await fixture((_req, res, body) => {
      calls++; expect((body.messages as Array<{ content: string }>)[0].content).toBe(text); json(res, envelope());
    });
    const adapter = createProvider(config(base));
    await adapter.complete({ messages: [{ role: 'user', content: text }] });
    await expect(adapter.complete({ messages: [{ role: 'user', content: 'x'.repeat(100000) }] }))
      .rejects.toMatchObject({ code: 'input_too_long' });
    expect(calls).toBe(1);
  });

  it('does not replace the configured endpoint with an HTTP redirect', async () => {
    const base = await fixture((_req, res) => { res.writeHead(302, { Location: 'https://foreign.example/chat' }); res.end(); });
    await expect(createProvider(config(base, { retries: 0 })).complete(request)).rejects.toMatchObject({ code: 'network' });
  });
});
