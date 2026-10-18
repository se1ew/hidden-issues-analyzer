import { describe, expect, it } from 'vitest';
import { evidenceSegments } from './evidence';

describe('original-text evidence highlighting', () => {
  it('uses UTF-16 across emoji and preserves every original character', () => {
    const text = '😀 Отлично\r\nНо шумит'; const quoteStart = text.indexOf('шумит');
    const segments = evidenceSegments(text, [{ quote: 'шумит', quoteStart, quoteEnd: quoteStart + 5 }], 'utf16');
    expect(segments.map(item => item.text).join('')).toBe(text);
    expect(segments.filter(item => item.highlighted)).toEqual([{ text: 'шумит', highlighted: true }]);
  });
  it('merges overlapping evidence spans without duplicating text', () => {
    const text = 'Крышка заедает и шумит';
    const segments = evidenceSegments(text, [{ quote: 'Крышка заедает', quoteStart: 0, quoteEnd: 14 },
      { quote: 'заедает и шумит', quoteStart: 7, quoteEnd: text.length }], 'utf16');
    expect(segments).toEqual([{ text, highlighted: true }]);
  });
  it('does not highlight invalid offsets, mismatched text or an unsupported coordinate unit', () => {
    const range = { quote: 'шумит', quoteStart: 0, quoteEnd: 5 };
    expect(evidenceSegments('тихий', [range], 'utf16')).toEqual([{ text: 'тихий', highlighted: false }]);
    expect(evidenceSegments('шумит', [range], 'utf8')).toEqual([{ text: 'шумит', highlighted: false }]);
    expect(evidenceSegments('шумит', [{ ...range, quoteStart: -1 }], 'utf16')).toEqual([{ text: 'шумит', highlighted: false }]);
  });
});
