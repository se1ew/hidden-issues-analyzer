import { describe, expect, it } from 'vitest';
import { ExtractionResultSchema, ModelExtractionSchema, validateComplaintSpecificity, validateExtractionEvidence, prepareExtraction, type ExtractionResult } from './extraction.service.js';

const make = (assertion: ExtractionResult['complaints'][number]['assertion'], quote: string): ExtractionResult => ({
  sentiment: 'positive', sentiment_score: 0.7,
  aspects: [{ name: 'звук', sentiment: 'positive' }, { name: 'удобство', sentiment: 'negative' }],
  complaints: [{ aspectIndex: 1, scope: 'product', description: 'давит оголовье', quote, assertion, consequences: null }],
});

describe('structured review extraction', () => {
  it('omits a generic opinion without suppressing concrete failures or surrounding context', () => {
    const result = make('experienced', 'Плохой товар!');
    result.complaints[0].description = 'плохой товар';
    expect(validateComplaintSpecificity(result).complaints).toEqual([]);
    for (const phrase of ['Не включается', 'Плохой товар: крышка отвалилась']) {
      result.complaints[0] = { ...result.complaints[0], description: phrase, quote: phrase };
      expect(validateComplaintSpecificity(result).complaints).toHaveLength(1);
    }
  });
  it('rejects a concrete claim supported only by a generic opinion, and the reverse', () => {
    const result = make('experienced', 'Плохой товар');
    expect(() => validateComplaintSpecificity(result)).toThrow();
    result.complaints[0] = { ...result.complaints[0], description: 'Плохой товар', quote: 'Крышка заедает' };
    expect(() => validateComplaintSpecificity(result)).toThrow();
  });
  it('creates aspect links on the server from nested evidence and refuses model-supplied indices', () => {
    const complaint = { scope: 'product', description: 'заедает крышка', quote: 'крышка заедает', assertion: 'experienced', consequences: null };
    const wire = { sentiment: 'positive', sentiment_score: 0.5, aspects: [
      { name: 'звук', sentiment: 'positive', complaints: [] },
      { name: 'удобство', sentiment: 'negative', complaints: [complaint] },
    ] };
    const result = ModelExtractionSchema.parse(wire);
    expect(result.complaints[0].aspectIndex).toBe(1);
    expect(prepareExtraction('Звук хороший, но крышка заедает', 5, result).aspects[1].category).toBe('usability');
    expect(ModelExtractionSchema.safeParse({ ...wire, aspects: [{ ...wire.aspects[1], complaints: [{ ...complaint, aspectIndex: 0 }] }] }).success).toBe(false);
    expect(ModelExtractionSchema.safeParse({ ...wire, aspects: [{ ...wire.aspects[1], name: 'крышка' }] }).success).toBe(false);
    expect(ExtractionResultSchema.safeParse(result).success).toBe(true);
  });
  it('collapses exact normalized complaint duplicates but retains distinct defects and spans', () => {
    const raw = make('experienced', 'давит оголовье');
    raw.aspects.push({ name: 'Комфорт', sentiment: 'negative' });
    raw.complaints.push({ ...raw.complaints[0], aspectIndex: 2, description: 'ДАВИТ ОГОЛОВЬЕ!' });
    raw.complaints.push({ ...raw.complaints[0], description: 'плохая регулировка' });
    raw.complaints.push({ ...raw.complaints[0], quote: 'также давит дужка' });
    const prepared = prepareExtraction('давит оголовье, также давит дужка', 5, raw);
    expect(prepared.complaints).toHaveLength(3);
    expect(prepared.complaints.every(item => item.masking.positiveContext)).toBe(true);
    expect(prepared.aspects[2]).toMatchObject({ name: 'удобство', originalName: 'Комфорт' });
  });
  it('rejects numeric confidence and invented danger fields instead of treating them as probabilities', () => {
    const raw = make('experienced', 'давит оголовье');
    expect(ExtractionResultSchema.safeParse({ ...raw, confidence: 0.99 }).success).toBe(false);
    expect(ExtractionResultSchema.safeParse({ ...raw, complaints: [{ ...raw.complaints[0], danger: 'high' }] }).success).toBe(false);
  });
  it('keeps unknown consequences null and retains all positive and neutral aspects without complaints', () => {
    const raw = make('experienced', 'давит оголовье');
    expect(prepareExtraction('давит оголовье', null, raw).complaints[0].consequences).toBeNull();
    const peaceful: ExtractionResult = { ...raw, complaints: [], aspects: [{ name: 'Звук', sentiment: 'positive' }, { name: 'Цвет', sentiment: 'neutral' }] };
    expect(prepareExtraction('Звук отличный, цвет серый', 5, peaceful).aspects).toMatchObject([
      { category: 'functionality', sentiment: 'positive' }, { category: 'appearance', sentiment: 'neutral' },
    ]);
  });
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
