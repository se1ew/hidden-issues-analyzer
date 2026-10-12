import { describe, expect, it } from 'vitest';
import { CSV_MAX_BYTES, CSV_MAX_ROWS, inspectReviewsCsv } from './csv.service.js';

describe('CSV inspection and row diagnostics', () => {
  it('preserves spaces, Unicode, quoted newlines and BOM with semicolon delimiter', () => {
    const result = inspectReviewsCsv(Buffer.from('\uFEFFТекст;Оценка;Дата;external_id;author_id\r\n"  Удобно\nно шумит  ";5;2024-02-29;ext;author\r\n'));
    expect(result.delimiter).toBe(';');
    expect(result.rows[0]).toMatchObject({ text: '  Удобно\nно шумит  ', rating: 5,
      date: new Date('2024-02-29'), externalId: 'ext', authorExternalId: 'author', rowNumber: 2 });
    expect(result.errorCount).toBe(0);
  });

  it('maps arbitrary columns and supports tabs', () => {
    const result = inspectReviewsCsv(Buffer.from('body\tvalue\twhen\nНормально\t4\t2026-01-01T12:00:00+03:00\n'),
      { mapping: { text: 'body', rating: 'value', date: 'when' } });
    expect(result.delimiter).toBe('\t');
    expect(result.rows[0].date).toEqual(new Date('2026-01-01T09:00:00Z'));
  });

  it('does not guess a delimiter from punctuation inside a quoted header', () => {
    const result = inspectReviewsCsv(Buffer.from('"body;long;name",rating\nОтзыв,5\n'), { mapping: { text: 'body;long;name' } });
    expect(result.delimiter).toBe(',');
    expect(result.validCount).toBe(1);
  });

  it('keeps missing rating and date missing, and accepts short nonempty text', () => {
    const result = inspectReviewsCsv(Buffer.from('text,rating,date\nОК,,\n'));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ text: 'ОК', rating: undefined, date: undefined });
  });

  it('counts invalid records once while listing each field error', () => {
    const result = inspectReviewsCsv(Buffer.from('text,rating,date\n,6,2024-02-30\nGood,3,2024-01-01\n'));
    expect(result).toMatchObject({ totalCount: 2, validCount: 1, errorCount: 1 });
    expect(result.errors.map((error) => error.field)).toEqual(['text', 'rating', 'date']);
    expect(result.errors.every((error) => error.rowNumber === 2)).toBe(true);
    expect(result.rows[0].rowNumber).toBe(3);
  });

  it.each(['0', '6', '3.4', '3,5', 'NaN', '1e0'])('rejects invalid rating %s rather than discarding or rounding it', (rating) => {
    const result = inspectReviewsCsv(Buffer.from(`text;rating\nОтзыв;${rating}\n`));
    expect(result.errorCount).toBe(1);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].field).toBe('rating');
  });

  it.each(['2023-02-29', '2024-04-31', '01/02/2024', '2024-01-01T24:00:00Z', '2024-01-01T12:00:00'])('rejects invalid or ambiguous date %s', (date) => {
    const result = inspectReviewsCsv(Buffer.from(`text,date\nОтзыв,${date}\n`));
    expect(result.errors[0].field).toBe('date');
  });

  it('keeps a deliberately disabled optional mapping disabled on the next request', () => {
    const csv = Buffer.from('text,rating\nОтзыв,invalid\n');
    const first = inspectReviewsCsv(csv, { mapping: { rating: '' } });
    expect(first.mapping.rating).toBe('');
    expect(inspectReviewsCsv(csv, { mapping: first.mapping }).validCount).toBe(1);
  });

  it('reports malformed record width without shifting column values', () => {
    const result = inspectReviewsCsv(Buffer.from('text,rating\nGood,5,extra\nGood\nFine,4\n'));
    expect(result).toMatchObject({ totalCount: 3, validCount: 1, errorCount: 2 });
    expect(result.rows[0].text).toBe('Fine');
  });

  it('reports a missing text mapping for preview rather than inventing one', () => {
    const result = inspectReviewsCsv(Buffer.from('body\nОтзыв\n'));
    expect(result.mapping.text).toBe('');
    expect(result.errors[0].field).toBe('text');
  });

  it.each(['text,Text\nA,B\n', 'text,\nA,B\n', 'text\n"unterminated'])('rejects invalid headers or structural CSV damage', (csv) => {
    expect(() => inspectReviewsCsv(Buffer.from(csv))).toThrow();
  });

  it('rejects unknown and duplicate mapped columns', () => {
    const csv = Buffer.from('text,rating\nОтзыв,5\n');
    expect(() => inspectReviewsCsv(csv, { mapping: { text: 'absent' } })).toThrow('отсутствует');
    expect(() => inspectReviewsCsv(csv, { mapping: { text: 'text', rating: 'text' } })).toThrow('одного поля');
  });

  it('rejects Windows-1251 bytes and UTF-16 instead of replacing damaged characters', () => {
    expect(() => inspectReviewsCsv(Buffer.from([0x74, 0x65, 0x78, 0x74, 0x0a, 0xff]))).toThrow('UTF-8');
    expect(() => inspectReviewsCsv(Buffer.from('text\nОтзыв', 'utf16le'))).toThrow('UTF-8');
  });

  it('enforces row, file and text limits', () => {
    expect(() => inspectReviewsCsv(Buffer.alloc(CSV_MAX_BYTES + 1))).toThrow('25 МиБ');
    expect(() => inspectReviewsCsv(Buffer.from('text\n' + 'Отзыв\n'.repeat(CSV_MAX_ROWS + 1)))).toThrow('10 000');
    const result = inspectReviewsCsv(Buffer.from('text\n' + 'a'.repeat(10_001)));
    expect(result.errors[0].field).toBe('text');
  });
});
