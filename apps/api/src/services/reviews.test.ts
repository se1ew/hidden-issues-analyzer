import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    product: { findFirst: vi.fn(), create: vi.fn() },
    review: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    uploadBatch: { create: vi.fn() },
  },
}));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware/error.js', () => ({ HttpError: class HttpError extends Error { constructor(public status: number, message: string) { super(message); } } }));

import { parseReviewsCsv } from './reviews.service.js';

describe('parseReviewsCsv', () => {
  it('парсит CSV с колонкой text + rating', () => {
    const csv = Buffer.from('text,rating\n"Отличный товар",5\n"Плохое качество",1\n');
    const rows = parseReviewsCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe('Отличный товар');
    expect(rows[0].rating).toBe(5);
    expect(rows[1].text).toBe('Плохое качество');
    expect(rows[1].rating).toBe(1);
  });

  it('парсит CSV с альтернативными именами колонок (review, score)', () => {
    const csv = Buffer.from('review,score\nGood product,4\n');
    const rows = parseReviewsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Good product');
    expect(rows[0].rating).toBe(4);
  });

  it('парсит CSV с колонкой comment', () => {
    const csv = Buffer.from('comment\nTekst otzyva\n');
    const rows = parseReviewsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Tekst otzyva');
  });

  it('пропускает строки с пустым текстом', () => {
    const csv = Buffer.from('text\n\n  \nValid text\n');
    const rows = parseReviewsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Valid text');
  });

  it('парсит CSV с разделителем ;', () => {
    const csv = Buffer.from('text;rating\nХороший;4\n');
    const rows = parseReviewsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Хороший');
    expect(rows[0].rating).toBe(4);
  });

  it('возвращает пустой массив если нет колонки текста', () => {
    const csv = Buffer.from('id,date\n1,2024-01-01\n');
    const rows = parseReviewsCsv(csv);
    expect(rows).toHaveLength(0);
  });

  it('обрезает рейтинг до диапазона 1-5', () => {
    const csv = Buffer.from('text,rating\nText1,0\nText2,6\nText3,3\n');
    const rows = parseReviewsCsv(csv);
    // 0 и 6 вне диапазона — должны быть null/undefined
    expect(rows.find((r) => r.text === 'Text1')?.rating).toBeUndefined();
    expect(rows.find((r) => r.text === 'Text2')?.rating).toBeUndefined();
    expect(rows.find((r) => r.text === 'Text3')?.rating).toBe(3);
  });

  it('парсит дату из колонки date', () => {
    const csv = Buffer.from('text,date\nText,2024-03-15\n');
    const rows = parseReviewsCsv(csv);
    expect(rows[0].date).toBeInstanceOf(Date);
    expect(rows[0].date!.getFullYear()).toBe(2024);
  });
});
