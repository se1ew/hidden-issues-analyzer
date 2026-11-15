import { describe, expect, it, vi } from 'vitest';
import { sourceEvidence } from './source-evidence.js';
import { prepareExtraction } from './extraction.service.js';
import { createProvider } from '../lib/llm.js';

const wire = (evidenceId: number, consequenceId: number | null = null) => ({
  sentiment: 'negative', sentiment_score: -0.5,
  aspects: [{ name: 'шум', sentiment: 'negative', complaints: [{
    description: 'громкий шум', assertion: 'experienced', evidenceId, consequenceId,
  }] }],
});
describe('selection of original source evidence', () => {
  it('assigns scope from the canonical aspect and keeps the old v7 wire format', () => {
    for (const [name, scope] of [['упаковка', 'packaging'], ['доставка', 'delivery'], ['продавец', 'seller'], ['качество', 'product']]) {
      const raw = wire(0); raw.aspects[0].name = name;
      expect(sourceEvidence('Проблема.').schema.parse(raw).complaints[0].scope).toBe(scope);
      const old = { ...raw, aspects: [{ ...raw.aspects[0], complaints: [{ ...raw.aspects[0].complaints[0], scope: 'product' }] }] };
      expect(sourceEvidence('Проблема.', false).schema.parse(old).complaints[0].scope).toBe('product');
      expect(sourceEvidence('Проблема.').schema.safeParse(old).success).toBe(false);
    }
  });
  it('copies exact source characters and resolves repeated occurrences with UTF-16 offsets', () => {
    const text = '😀 Всё хорошо. Шумит. Шумит.';
    const contract = sourceEvidence(text);
    const occurrences = contract.spans.filter(span => span.text === 'Шумит.');
    expect(occurrences).toHaveLength(2);
    const result = contract.schema.parse(wire(occurrences[1].id));
    const complaint = prepareExtraction(text, 2, result).complaints[0];
    expect(complaint.quoteStart).toBe(text.lastIndexOf('Шумит.'));
    expect(text.slice(complaint.quoteStart, complaint.quoteEnd)).toBe(complaint.quote);
  });
  it('accepts only supplied IDs and refuses model text or numeric quote positions', () => {
    const contract = sourceEvidence('Шумит.');
    for (const id of [-1, 999, 0.5]) expect(contract.schema.safeParse(wire(id)).success).toBe(false);
    const raw = wire(0);
    for (const extra of [{ quote: 'придуманный шум' }, { quoteStart: 10 }, { aspectIndex: 0 }]) {
      expect(contract.schema.safeParse({ ...raw, aspects: [{ ...raw.aspects[0], complaints: [{ ...raw.aspects[0].complaints[0], ...extra }] }] }).success).toBe(false);
    }
  });
  it('allows a consequence only within the selected quote, including its occurrence', () => {
    const text = 'Мотор шумит, мешает разговаривать. Корпус холодный.';
    const contract = sourceEvidence(text);
    const sentence = contract.spans.find(span => span.text === 'Мотор шумит, мешает разговаривать.')!;
    const consequence = contract.spans.find(span => span.text === 'мешает разговаривать.')!;
    const other = contract.spans.find(span => span.text === 'Корпус холодный.')!;
    expect(contract.schema.parse(wire(sentence.id, consequence.id)).complaints[0].consequences).toBe('мешает разговаривать.');
    expect(contract.schema.safeParse(wire(sentence.id, other.id)).success).toBe(false);
    expect(contract.schema.parse(wire(sentence.id)).complaints[0].consequences).toBeNull();
  });
  it('bounds candidates without losing the option to cite any original context', () => {
    const text = 'Шумит, трещит. '.repeat(100);
    const contract = sourceEvidence(text);
    expect(contract.spans.length).toBeLessThanOrEqual(64);
    expect(contract.spans[0].text).toBe(text.trim());
    expect(sourceEvidence(' ').schema.safeParse({ sentiment: 'neutral', sentiment_score: 0, aspects: [] }).success).toBe(true);
    expect(sourceEvidence(' ').schema.safeParse(wire(0)).success).toBe(false);
  });
  it('decodes an actual HTTP response through the selection schema', async () => {
    const contract = sourceEvidence('Левый наушник тише правого.');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(wire(0)) } }] }))));
    try {
      const provider = createProvider({ provider: 'local', baseUrl: 'http://localhost/v1', model: 'fixture', timeoutMs: 1000,
        contextTokens: 4096, maxOutputTokens: 1024, concurrency: 1, retries: 0, retryDelayMs: 0,
        maxRetryDelayMs: 1000, responseFormat: 'json_object', cloudDelayMs: 0 });
      const result = await provider.completeJson({ messages: [{ role: 'user', content: contract.userPrompt }], jsonSchema: contract.jsonSchema }, contract.schema);
      expect(result.complaints[0]).toMatchObject({ quote: 'Левый наушник тише правого.', quoteStart: 0, quoteEnd: 'Левый наушник тише правого.'.length });
    } finally { vi.unstubAllGlobals(); }
  });
});
