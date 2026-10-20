import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { inspectCsvFile } from './streaming-csv.service.js';
import { inspectReviewsCsv } from './csv.service.js';
import type { ImportRow } from './imports.service.js';

async function withFile(content: Buffer, run: (file: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hia-stream-test-'));
  const file = path.join(root, 'input.csv');
  try { await writeFile(file, content); await run(file); }
  finally { await rm(root, { recursive: true, force: true }); }
}
describe('streaming CSV production import reader', () => {
  it('matches synchronous validation while bounding batches and preserving global row numbers', async () => {
    const buffer = Buffer.from('\uFEFFtext;rating;date;external_id\n' + Array.from({ length: 215 }, (_, i) => `"  Строка ${i} 😀\nвторая строка  ";${i % 100 === 0 ? 9 : 5};2026-01-01;${i}`).join('\n'));
    await withFile(buffer, async file => {
      const rows: ImportRow[] = []; const checkpoints: number[] = [];
      const actual = await inspectCsvFile(file, {}, async (batch, through) => {
        expect(batch.length).toBeLessThanOrEqual(100); rows.push(...batch); checkpoints.push(through);
      });
      const expected = inspectReviewsCsv(buffer);
      expect(rows).toEqual(expected.rows);
      expect(actual).toMatchObject({ headers: expected.headers, mapping: expected.mapping, delimiter: ';', sha256: expected.sha256,
        errors: expected.errors, errorCount: 3, totalCount: 215, validCount: 212, sample: expected.sample });
      expect(checkpoints).toEqual([100, 200, 215]);
    });
  });
  it('does not replace invalid UTF-8 across stream boundaries', async () => {
    const prefix = Buffer.from('text\n' + ('a'.repeat(1000) + '\n').repeat(70));
    const buffer = Buffer.concat([prefix, Buffer.from([0xc3, 0x28])]);
    await withFile(buffer, async file => {
      await expect(inspectCsvFile(file)).rejects.toMatchObject({ status: 422 });
    });
    await withFile(Buffer.from([0x74, 0x65, 0x78, 0x74, 0x0a, 0xc3, 0x28]), async file => {
      await expect(inspectCsvFile(file)).rejects.toMatchObject({ status: 422 });
    });
  });
  it('rejects malformed structure and supports explicit arbitrary mappings', async () => {
    await withFile(Buffer.from('body\tstars\n"Запятая, кавычки ""внутри"""\t4\n'), async file => {
      const rows: ImportRow[] = [];
      const result = await inspectCsvFile(file, { mapping: { text: 'body', rating: 'stars' } }, async batch => { rows.push(...batch); });
      expect(result.validCount).toBe(1); expect(rows[0].text).toBe('Запятая, кавычки "внутри"');
    });
    await withFile(Buffer.from('text\n"незакрытая кавычка'), async file => {
      await expect(inspectCsvFile(file)).rejects.toMatchObject({ status: 422 });
    });
  });
});
