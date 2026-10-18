import { describe, expect, it } from 'vitest';
import { locateQuote, maskingContext } from './evidence.js';
import { normalizeAspect } from './aspects.js';

describe('source evidence identity and masking context', () => {
  it('uses original UTF-16 positions through emoji, combining marks and CRLF', () => {
    const text = '😀 Хорошо\r\nе\u0308щё: крышка заедает!';
    const range = locateQuote(text, 'крышка заедает')!;
    expect(range).toEqual({ quoteStart: text.indexOf('крышка'), quoteEnd: text.indexOf('крышка') + 'крышка заедает'.length, offsetUnit: 'utf16' });
    expect(text.slice(range.quoteStart, range.quoteEnd)).toBe('крышка заедает');
  });
  it('rejects absent, empty and ambiguous quotes including overlapping occurrences', () => {
    expect(locateQuote('нет дефекта', '')).toBeNull();
    expect(locateQuote('нет дефекта', 'цитата')).toBeNull();
    expect(locateQuote('шумит и шумит', 'шумит')).toBeNull();
    expect(locateQuote('aaa', 'aa')).toBeNull();
  });
  it.each([
    [5, 'negative', true, true, ['high_rating']],
    [null, 'positive', null, true, ['positive_sentiment']],
    [null, 'negative', null, false, []],
    [2, 'positive', false, true, ['positive_sentiment']],
    [4, 'positive', true, true, ['high_rating', 'positive_sentiment']],
  ] as const)('separates rating %s and sentiment %s', (rating, sentiment, highRating, positiveContext, reasons) => {
    expect(maskingContext(rating, sentiment)).toMatchObject({ rating, highRating, positiveContext, reasons });
  });
  it('normalizes known aliases and preserves an unfamiliar aspect without guessing its category', () => {
    expect(normalizeAspect(' КАЧЕСТВО  ЗВУКА! ')).toEqual({ category: 'functionality', name: 'звук', originalName: ' КАЧЕСТВО  ЗВУКА! ' });
    expect(normalizeAspect('Свечение индикатора')).toEqual({ category: 'other', name: 'Свечение индикатора', originalName: 'Свечение индикатора' });
    expect(normalizeAspect('Доставка').category).toBe('delivery');
    expect(normalizeAspect('Продавец').category).toBe('seller');
    expect(normalizeAspect('Коробка').category).toBe('packaging');
  });
});
