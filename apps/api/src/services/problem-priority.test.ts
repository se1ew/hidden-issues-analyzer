import { describe, expect, it } from 'vitest';
import { groupMetrics, type GroupingPoint } from './grouping-engine.js';
import { consequenceCategory, priorityIndicator } from './problem-priority.js';
const point = (id: string, more: Partial<GroupingPoint> = {}): GroupingPoint => ({ id, reviewId: id, productId: 'p', runId: 'r', inputHash: id,
  defect: 'дефект', quote: 'корпус раскалился, получил ожог', quoteStart: 0, quoteEnd: 29, category: 'quality', aspect: 'качество', scope: 'product',
  rating: null, sentiment: 'negative', importedAt: new Date(), consequences: null, ...more });

describe('transparent problem priority', () => {
  it('categorizes only consequences literally contained in evidence', () => {
    expect(consequenceCategory('получил ожог', 'получил ожог')).toBe('reported_harm');
    expect(consequenceCategory('перестал работать', 'перестал работать')).toBe('loss_of_use');
    expect(consequenceCategory('получил ожог', 'всё хорошо')).toBe('undetermined');
    expect(consequenceCategory('без травм', 'без травм')).toBe('reported');
    expect(consequenceCategory('ожогов нет.', 'ожогов нет.')).toBe('reported');
    expect(consequenceCategory('ожога удалось избежать', 'ожога удалось избежать')).toBe('reported');
    expect(consequenceCategory(null, 'получил ожог')).toBe('undetermined');
  });
  it('never derives consequences or severity from negative sentiment', () => {
    const metric = groupMetrics([point('a')], { total: 5, succeeded: 1, failed: 2 }, 2);
    expect(metric.consequences).toEqual([]);
    expect(metric.priority).toMatchObject({ consequenceRank: 0, evidenceLabel: 'Мало подтверждений' });
    expect(metric.coverage).toMatchObject({ ratio: 0.2, remaining: 2 });
    expect(metric.highRatingShare).toBeNull();
  });
  it('uses unique support and separates rating from sentiment and missing data', () => {
    const metric = groupMetrics([point('a', { rating: 5 }), point('dup', { reviewId: 'a', rating: 5 }),
      point('b', { sentiment: 'positive' }), point('c')], { total: 8, succeeded: 4, failed: 2 }, 2);
    expect(metric).toMatchObject({ support: 3, mentionCount: 4, prevalence: 0.75, highRatingCount: 1, knownRatingCount: 1,
      positiveSentimentCount: 1, positiveContextCount: 2, hidden: true });
    expect(metric.priority).toMatchObject({ support: 3, positiveContextCount: 2, version: 'support-masking-consequence-v1' });
  });
  it('keeps widespread negative defects visible and ranks support before masking', () => {
    expect(priorityIndicator(20, 0, 3, false).score).toBeGreaterThan(priorityIndicator(19, 19, 0, false).score);
    expect(priorityIndicator(3, 2, 0, false).score).toBeGreaterThan(priorityIndicator(3, 1, 3, false).score);
    const metric = groupMetrics([point('a', { consequences: 'получил ожог' }), point('b')], { total: 2, succeeded: 2, failed: 0 }, 2);
    expect(metric).toMatchObject({ prevalence: 1, hidden: false, signal: false });
    expect(metric.consequences).toEqual([{ mentionId: 'a', text: 'получил ожог', quote: 'корпус раскалился, получил ожог', category: 'reported_harm' }]);
  });
  it('leaves zero denominators unknown and excludes unverified consequences', () => {
    expect(groupMetrics([], { total: 0, succeeded: 0, failed: 0 }, 2)).toMatchObject({ prevalence: null, highRatingShare: null, positiveSentimentShare: null });
    expect(groupMetrics([point('a', { consequences: 'выдуманное последствие' })], { total: 1, succeeded: 1, failed: 0 }, 2).consequences).toEqual([]);
  });
});
