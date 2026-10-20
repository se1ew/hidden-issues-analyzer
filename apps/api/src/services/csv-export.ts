import { LIMITS } from '../lib/resource-limits.js';
import { HttpError } from '../middleware/error.js';
// Quote every field and neutralize spreadsheet formulas even after leading controls/spaces.
export function csvCell(value: unknown): string {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function csvDocument(rows: unknown[][]): string {
  let bytes = 3;
  const lines = rows.map(row => { const line = row.map(csvCell).join(','); bytes += Buffer.byteLength(line) + 2; if (bytes > LIMITS.exportBytes) throw new HttpError(413, 'CSV превышает 20 МиБ. Уточните фильтры.'); return line; });
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
