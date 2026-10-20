import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import { CSV_MAX_BYTES, CSV_MAX_ROWS, detectDelimiter, inspectReviewsCsv, type CsvOptions, type CsvRowError } from './csv.service.js';
import type { ImportRow } from './imports.service.js';
import { HttpError } from '../middleware/error.js';

const encodeRecord = (values: string[]) => values.map(value => `"${value.replace(/"/g, '""')}"`).join(',');

/** Streaming UTF-8 validation and row processing; at most 100 parsed records per batch. */
export async function inspectCsvFile(file: string, options: CsvOptions = {},
  consume?: (rows: ImportRow[], throughRecord: number) => Promise<void>) {
  const handle = await open(file, 'r');
  let delimiter = options.delimiter;
  try {
    const prefix = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    try { delimiter ??= detectDelimiter(new TextDecoder('utf-8', { fatal: true }).decode(prefix.subarray(0, bytesRead), { stream: true })); }
    catch { throw new HttpError(422, 'CSV должен быть в UTF-8. Пересохраните файл в UTF-8 (можно с BOM).'); }
  } finally { await handle.close(); }
  const hash = createHash('sha256');
  async function* decoded() {
    const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0;
    for await (const value of createReadStream(file, { highWaterMark: 65536 })) {
      const chunk = value as Buffer; bytes += chunk.length;
      if (bytes > CSV_MAX_BYTES) throw new HttpError(413, 'CSV превышает 25 МиБ');
      hash.update(chunk);
      let text: string;
      try { text = decoder.decode(chunk, { stream: true }); }
      catch { throw new HttpError(422, 'CSV должен быть в UTF-8. Пересохраните файл в UTF-8 (можно с BOM).'); }
      if (text.includes('\0')) throw new HttpError(422, 'CSV содержит нулевые байты. Проверьте кодировку UTF-8.');
      yield text;
    }
    try { yield decoder.decode(); }
    catch { throw new HttpError(422, 'CSV должен быть в UTF-8. Пересохраните файл в UTF-8 (можно с BOM).'); }
  }
  const parser = parse({ delimiter, bom: true, skip_empty_lines: true, trim: false, relax_column_count: true, max_record_size: 65536 });
  const pumping = pipeline(Readable.from(decoded()), parser);
  void pumping.catch(() => undefined);
  let headers: string[] | undefined;
  let mapping: ReturnType<typeof inspectReviewsCsv>['mapping'] = {};
  const errors: CsvRowError[] = [];
  const sample: Array<{ rowNumber: number; values: string[] }> = [];
  let records: string[][] = []; let totalCount = 0; let validCount = 0; let errorCount = 0;
  const flush = async () => {
    if (!headers || !records.length) return;
    const offset = totalCount - records.length;
    const inspected = inspectReviewsCsv(Buffer.from([encodeRecord(headers), ...records.map(encodeRecord)].join('\n')), { ...options, delimiter: ',' });
    mapping = inspected.mapping;
    errors.push(...inspected.errors.map(error => ({ ...error, rowNumber: error.rowNumber + offset })));
    validCount += inspected.validCount; errorCount += inspected.errorCount;
    if (consume) await consume(inspected.rows.map(row => ({ ...row, rowNumber: row.rowNumber! + offset })), totalCount);
    records = [];
  };
  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      if (!headers) {
        headers = record;
        mapping = inspectReviewsCsv(Buffer.from(encodeRecord(headers)), { ...options, delimiter: ',' }).mapping;
        continue;
      }
      totalCount++;
      if (totalCount > CSV_MAX_ROWS) throw new HttpError(413, 'CSV содержит больше 10 000 записей');
      if (sample.length < 5) sample.push({ rowNumber: totalCount + 1, values: record });
      records.push(record);
      if (records.length === 100) await flush();
    }
    await pumping; await flush();
  } catch (error) {
    parser.destroy();
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && 'code' in error && String(error.code).startsWith('CSV_')) {
      throw new HttpError(422, 'CSV повреждён: проверьте кавычки, разделитель и размер записи (до 65 536 символов).');
    }
    throw error;
  }
  if (!headers) throw new HttpError(422, 'CSV пуст');
  return { headers: headers.map(header => header.trim()), delimiter: delimiter!, mapping, totalCount, validCount, errorCount, errors, sample, sha256: hash.digest('hex') };
}
