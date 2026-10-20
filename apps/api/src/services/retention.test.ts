import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { containedFile } from './retention.service.js';
describe('storage deletion boundary', () => {
  const root = path.resolve('reports_output');
  it('accepts application artifacts and transient inputs within the exact storage directory', () => {
    expect(containedFile(root, path.join(root, 'report-abc-123.pdf'))).toBe(true);
    expect(containedFile(root, path.join(root, 'report-abc-123.docx.input.json'))).toBe(true);
  });
  it.each(['../report-abc.pdf', 'sub/report-abc.pdf', 'database.dump', 'report-abc.pdf.exe'])('rejects deletion target %s', file => {
    expect(containedFile(root, path.join(root, file))).toBe(false);
  });
});
