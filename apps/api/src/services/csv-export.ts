// Quote every field and neutralize spreadsheet formulas even after leading controls/spaces.
export function csvCell(value: unknown): string {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function csvDocument(rows: unknown[][]): string {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
