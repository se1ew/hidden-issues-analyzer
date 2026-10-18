export interface EvidenceRange { quote: string; quoteStart: number; quoteEnd: number }

/** Original JS string, zero-based UTF-16 code units, exclusive end. */
export function evidenceSegments(text: string, ranges: EvidenceRange[], offsetUnit: string) {
  if (offsetUnit !== 'utf16') return [{ text, highlighted: false }];
  const valid = ranges.filter((range) => Number.isInteger(range.quoteStart) && Number.isInteger(range.quoteEnd)
    && range.quoteStart >= 0 && range.quoteEnd > range.quoteStart && range.quoteEnd <= text.length
    && text.slice(range.quoteStart, range.quoteEnd) === range.quote)
    .sort((a, b) => a.quoteStart - b.quoteStart || a.quoteEnd - b.quoteEnd);
  const spans: Array<{ start: number; end: number }> = [];
  for (const range of valid) {
    const previous = spans.at(-1);
    if (previous && range.quoteStart <= previous.end) previous.end = Math.max(previous.end, range.quoteEnd);
    else spans.push({ start: range.quoteStart, end: range.quoteEnd });
  }
  const segments: Array<{ text: string; highlighted: boolean }> = []; let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) segments.push({ text: text.slice(cursor, span.start), highlighted: false });
    segments.push({ text: text.slice(span.start, span.end), highlighted: true }); cursor = span.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}
