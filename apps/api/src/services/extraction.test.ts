import { describe, expect, it } from 'vitest';
import { ExtractionResultSchema, validateExtractionEvidence, type ExtractionResult } from './extraction.service.js';

const make = (assertion: ExtractionResult['complaints'][number]['assertion'], quote: string): ExtractionResult => ({
  sentiment: 'positive', sentiment_score: 0.7,
  aspects: [{ name: 'звук', sentiment: 'positive' }, { name: 'удобство', sentiment: 'negative' }],
  complaints: [{ aspectIndex: 1, scope: 'product', description: 'давит оголовье', quote, assertion, consequences: null }],
});

describe('structured review extraction', () => {
  it('preserves positive overall sentiment, all aspects and multiple actual complaints', () => {
    const source = 'Звук отличный, но давит оголовье. Ещё треснул корпус.';
    const result = make('experienced', 'давит оголовье');
    result.complaints.push({ ...result.complaints[0], description: 'треснул корпус', quote: 'треснул корпус' });
    expect(validateExtractionEvidence(source, result)).toMatchObject({
      sentiment: 'positive', aspects: result.aspects, complaints: result.complaints,
    });
  });
  it.each([
    ['negated', 'Ничего не ломается'],
    ['hypothetical', 'Если сломается, верну'],
    ['no_experience', 'Ещё не использовал, говорят ломается'],
  ] as const)('excludes %s from actual defects', (assertion, text) => {
    expect(validateExtractionEvidence(text, make(assertion, text)).complaints).toEqual([]);
  });
  it('retains a real failure expressed using a negative verb', () => {
    expect(validateExtractionEvidence('Не включается.', make('experienced', 'Не включается')).complaints).toHaveLength(1);
  });
  it('rejects invented evidence and consequences rather than substituting the whole text', () => {
    expect(() => validateExtractionEvidence('Звук отличный', make('experienced', 'давит оголовье'))).toThrow(/Цитата/);
    const result = make('experienced', 'давит оголовье');
    result.complaints[0].consequences = 'травма';
    expect(() => validateExtractionEvidence('давит оголовье', result)).toThrow(/Последствия/);
  });
  it('requires explicit consequences or null, valid aspect links and complete complaint objects', () => {
    const result = make('experienced', 'давит оголовье');
    expect(ExtractionResultSchema.safeParse({ ...result, complaints: ['плохо'] }).success).toBe(false);
    expect(ExtractionResultSchema.safeParse({ ...result, complaints: [{ ...result.complaints[0], aspectIndex: 2 }] }).success).toBe(false);
    expect(ExtractionResultSchema.safeParse({ ...result, complaints: [{ ...result.complaints[0], consequences: undefined }] }).success).toBe(false);
  });
  it('allows negative sentiment with no proven complaint and keeps delivery separate', () => {
    expect(ExtractionResultSchema.parse({ sentiment: 'negative', sentiment_score: -0.5, aspects: [], complaints: [] }).complaints).toEqual([]);
    const result = make('experienced', 'Курьер опоздал');
    result.complaints[0].scope = 'delivery';
    expect(validateExtractionEvidence('Курьер опоздал', result).complaints[0].scope).toBe('delivery');
  });
});
