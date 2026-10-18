import { describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { csvCell, csvDocument } from './csv-export.js';
describe('spreadsheet-safe UTF-8 CSV', () => {
  it('roundtrips commas, quotes, Cyrillic and multiline text', () => {
    const rows = [['id', 'text', 'rating'], ['1', 'Крышка, "плотная"\r\nно заедает', 5], ['2', 'Обычный отзыв', null]];
    const encoded = csvDocument(rows);
    expect(encoded.startsWith('\uFEFF')).toBe(true);
    expect(parse(encoded, { bom: true })).toEqual([['id', 'text', 'rating'], ['1', 'Крышка, "плотная"\r\nно заедает', '5'], ['2', 'Обычный отзыв', '']]);
  });
  it.each(['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', '  =1+1', '\t=HYPERLINK("x")', '\rобычный', '\nтекст'])('neutralizes formula or control prefix %j', value => {
    expect(csvCell(value).startsWith('"\'')).toBe(true);
  });
});
