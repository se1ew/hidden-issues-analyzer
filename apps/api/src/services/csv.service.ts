import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import { HttpError } from '../middleware/error.js';
import type { ImportRow } from './imports.service.js';

export const CSV_MAX_BYTES = 25 * 1024 * 1024;
export const CSV_MAX_ROWS = 10_000;
export const CsvOptionsSchema = z.object({
  delimiter: z.enum([',', ';', '\t']).optional(),
  mapping: z.object({
    text: z.string().max(200).optional(), rating: z.string().max(200).optional(),
    date: z.string().max(200).optional(), externalId: z.string().max(200).optional(),
    authorExternalId: z.string().max(200).optional(),
  }).strict().optional(),
}).strict();
export type CsvOptions = z.infer<typeof CsvOptionsSchema>;
export interface CsvRowError { rowNumber: number; field: string; message: string }

const aliases = {
  text: ['text', 'review', 'comment', 'feedback', 'review_text', 'content', 'текст', 'отзыв'],
  rating: ['rating', 'score', 'stars', 'mark', 'рейтинг', 'оценка'],
  date: ['date', 'created_at', 'review_date', 'published_at', 'дата'],
  externalId: ['external_id', 'review_id', 'id_отзыва'],
  authorExternalId: ['author_id', 'id_автора'],
};
type Field = keyof typeof aliases;
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '_');

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    }
    if (!quoted && (char === '\n' || char === '\r')) break;
    if (!quoted && char in counts) counts[char as keyof typeof counts]++;
  }
  return (Object.keys(counts) as Array<keyof typeof counts>).sort((a, b) => counts[b] - counts[a])[0];
}

// Accept date-only ISO or a full timestamp with an explicit timezone.
function parseDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, zone] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return undefined;
  if (hour && (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59)) return undefined;
  if (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return undefined;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? undefined : result;
}

export function inspectReviewsCsv(buffer: Buffer, options: CsvOptions = {}) {
  if (buffer.length > CSV_MAX_BYTES) throw new HttpError(413, 'CSV превышает 25 МиБ');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new HttpError(422, 'CSV должен быть в UTF-8. Пересохраните файл в UTF-8 (можно с BOM).'); }
  if (text.includes('\0')) throw new HttpError(422, 'CSV содержит нулевые байты. Проверьте кодировку UTF-8.');
  const delimiter = options.delimiter ?? detectDelimiter(text);
  let records: string[][];
  try {
    records = parse(text, { delimiter, bom: true, skip_empty_lines: true, trim: false,
      relax_column_count: true, max_record_size: 65_536, to: CSV_MAX_ROWS + 2 }) as string[][];
  } catch {
    throw new HttpError(422, 'CSV повреждён: проверьте кавычки, разделитель и размер записи (до 65 536 символов).');
  }
  if (!records.length) throw new HttpError(422, 'CSV пуст');
  const headers = records[0].map((value) => value.trim());
  if (headers.length > 100 || headers.some((value) => !value || value.length > 200)
    || new Set(headers.map(normalize)).size !== headers.length) {
    throw new HttpError(422, 'Заголовки должны быть непустыми и уникальными: до 100 колонок, до 200 символов.');
  }
  if (records.length - 1 > CSV_MAX_ROWS) throw new HttpError(413, 'CSV содержит больше 10 000 записей');
  const mapping: Partial<Record<Field, string>> = {};
  for (const field of Object.keys(aliases) as Field[]) {
    const configured = options.mapping?.[field];
    const column = configured !== undefined ? configured : headers.find((value) => aliases[field].includes(normalize(value)));
    if (column) {
      if (!headers.includes(column)) throw new HttpError(422, 'Указанная колонка отсутствует в CSV');
      mapping[field] = column;
    } else mapping[field] = '';
  }
  const selected = Object.values(mapping).filter(Boolean);
  if (new Set(selected).size !== selected.length) {
    throw new HttpError(422, 'Каждая колонка может использоваться только для одного поля');
  }
  const rows: ImportRow[] = [];
  const errors: CsvRowError[] = [];
  let errorCount = 0;
  const read = (record: string[], field: Field) => mapping[field] ? record[headers.indexOf(mapping[field]!)] ?? '' : '';
  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2;
    const rowErrors: CsvRowError[] = [];
    const invalid = (field: string, message: string) => rowErrors.push({ rowNumber, field, message });
    if (record.length !== headers.length) invalid('row', 'Число значений не совпадает с числом колонок');
    const originalText = read(record, 'text');
    if (!mapping.text) invalid('text', 'Выберите колонку текста');
    else if (!originalText.trim()) invalid('text', 'Текст пуст');
    else if (originalText.length > 10_000) invalid('text', 'Текст превышает 10 000 символов');
    const ratingRaw = read(record, 'rating').trim();
    const rating = ratingRaw ? Number(ratingRaw) : undefined;
    if (ratingRaw && (!/^[1-5]$/.test(ratingRaw))) invalid('rating', 'Оценка должна быть целым числом от 1 до 5');
    const dateRaw = read(record, 'date').trim();
    const date = dateRaw ? parseDate(dateRaw) : undefined;
    if (dateRaw && !date) invalid('date', 'Дата должна быть YYYY-MM-DD или ISO-временем с часовым поясом');
    const externalId = read(record, 'externalId').trim() || undefined;
    const authorExternalId = read(record, 'authorExternalId').trim() || undefined;
    if (externalId && externalId.length > 200) invalid('externalId', 'ID превышает 200 символов');
    if (authorExternalId && authorExternalId.length > 200) invalid('authorExternalId', 'ID превышает 200 символов');
    if (rowErrors.length) { errorCount++; errors.push(...rowErrors); }
    else rows.push({ text: originalText, rating, date, externalId, authorExternalId, rowNumber });
  });
  return { headers, delimiter, mapping, totalCount: records.length - 1,
    validCount: rows.length, errorCount, errors, rows,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    sample: records.slice(1, 6).map((values, index) => ({ rowNumber: index + 2, values })),
  };
}
