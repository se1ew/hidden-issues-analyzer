import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProvider, type LlmProvider } from '../lib/llm.js';
import { ExtractionResultSchema, EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT, prepareExtraction, type ExtractionResult } from './extraction.service.js';

interface ReviewCase { id: string; text: string; rating: number | null;
  expected: { sentiments: ExtractionResult['sentiment'][]; positiveContext: boolean;
    issues: Array<{ aspect: string; scope: 'product' | 'delivery' | 'seller' | 'packaging'; defect: string; quote: string }> } }
const cases = JSON.parse(readFileSync(new URL('../../../../docs/fixtures/review-cases.json', import.meta.url), 'utf8')).cases as ReviewCase[];
let server: Server; let provider: LlmProvider; let reply: unknown; let receivedText = '';
beforeAll(async () => {
  server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk.toString();
    const body = JSON.parse(raw);
    receivedText = body.messages[1].content;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  provider = createProvider({ provider: 'local', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    model: 'annotated-fixture', timeoutMs: 1000, contextTokens: 32768, maxOutputTokens: 2048,
    concurrency: 1, retries: 0, retryDelayMs: 0, maxRetryDelayMs: 1000, responseFormat: 'json_schema', cloudDelayMs: 0 });
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
async function extract(text: string, rating: number | null) {
  const raw = await provider.completeJson({ messages: [{ role: 'system', content: EXTRACTION_PROMPT }, { role: 'user', content: text }],
    jsonSchema: EXTRACTION_JSON_SCHEMA, schemaName: 'review_analysis' }, ExtractionResultSchema);
  return prepareExtraction(text, rating, raw);
}

describe('annotated extraction through the production HTTP adapter (not a model quality evaluation)', () => {
  it.each(cases)('preserves evidence and context for $id', async (review) => {
    reply = { sentiment: review.expected.sentiments[0], sentiment_score: 0,
      aspects: review.expected.issues.map(issue => ({ name: issue.aspect, sentiment: 'negative' })),
      complaints: review.expected.issues.map((issue, aspectIndex) => ({ aspectIndex, scope: issue.scope,
        description: issue.defect, quote: issue.quote, assertion: 'experienced', consequences: null })) };
    const extracted = await extract(review.text, review.rating);
    expect(receivedText).toBe(review.text);
    expect(extracted.complaints.map(issue => issue.quote)).toEqual(review.expected.issues.map(issue => issue.quote));
    for (const issue of extracted.complaints) {
      expect(review.text.slice(issue.quoteStart, issue.quoteEnd)).toBe(issue.quote);
      expect(issue.masking.positiveContext).toBe(review.expected.positiveContext);
    }
  });
  it('retains annotated sarcasm, delivery and distinct aspects without deriving sentiment from the rating', async () => {
    reply = { sentiment: 'negative', sentiment_score: -0.7, aspects: [{ name: 'Качество', sentiment: 'negative' }, { name: 'Доставка', sentiment: 'negative' }],
      complaints: [{ aspectIndex: 0, scope: 'product', description: 'поломка', quote: 'сломался на второй день', assertion: 'experienced', consequences: null },
        { aspectIndex: 1, scope: 'delivery', description: 'опоздание', quote: 'Курьер опоздал', assertion: 'experienced', consequences: null }] };
    const result = await extract('Прекрасно, сломался на второй день! Курьер опоздал.', 5);
    expect(result.result.sentiment).toBe('negative');
    expect(result.complaints[0].masking.reasons).toEqual(['high_rating']);
    expect(result.complaints[1].scope).toBe('delivery');
    expect(result.aspects.map(aspect => aspect.category)).toEqual(['quality', 'delivery']);
  });
  it('passes the full long text and rejects an empty provider response', async () => {
    const text = `${'Длинный контекст. '.repeat(250)}В конце крышка заедает.`;
    reply = { sentiment: 'neutral', sentiment_score: 0, aspects: [{ name: 'Удобство', sentiment: 'negative' }],
      complaints: [{ aspectIndex: 0, scope: 'product', description: 'заедание', quote: 'В конце крышка заедает', assertion: 'experienced', consequences: null }] };
    expect((await extract(text, null)).complaints[0].quoteEnd).toBe(text.length - 1);
    expect(receivedText).toBe(text);
    reply = '';
    await expect(extract('Пустой ответ', null)).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
