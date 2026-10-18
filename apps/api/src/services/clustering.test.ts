import { describe, expect, it } from 'vitest';
import { clusterMentions, groupMetrics, normalizedVector, stableMatches, type GroupingPoint } from './grouping-engine.js';
import { GroupingSettingsSchema } from '../schemas/grouping.schema.js';
const settings = GroupingSettingsSchema.parse({});
const point = (id: string, values: Partial<GroupingPoint> = {}): GroupingPoint => ({
  id, reviewId: id, productId: 'product', runId: 'run', inputHash: id, defect: 'крышка заедает', quote: 'крышка заедает', quoteStart: 0, quoteEnd: 14,
  category: 'usability', aspect: 'удобство', scope: 'product', rating: 5, sentiment: 'positive', importedAt: new Date('2026-10-01'), consequences: null, ...values,
});
const coverage = { total: 10, succeeded: 8, failed: 2 };
const vector = (angle: number) => [Math.cos(angle), Math.sin(angle)];

describe('run-scoped production grouping algorithm', () => {
  it('isolates products, runs and delivery even for identical vectors', () => {
    const points = [point('a'), point('b'), point('c', { productId: 'other' }), point('d', { runId: 'other' }),
      point('e', { scope: 'delivery', category: 'delivery', aspect: 'доставка' })];
    const groups = clusterMentions(points, points.map(() => [1, 0]), coverage, settings);
    expect(groups.map(group => group.points.length).sort()).toEqual([1, 1, 1, 2]);
    expect(groups.reduce((sum, group) => sum + group.points.length, 0)).toBe(points.length);
  });
  it('does not turn repeated mentions of one review into a repeated problem', () => {
    const groups = clusterMentions([point('a'), point('b', { reviewId: 'a' })], [[1, 0], [1, 0]], coverage, settings);
    expect(groups[0].metrics).toMatchObject({ support: 1, mentionCount: 2, signal: true, hidden: false });
  });
  it('keeps distinct defects of one aspect apart despite a shared word', () => {
    const points = [point('a'), point('b'), point('c', { defect: 'крышка сломалась' }), point('d', { defect: 'крышка сломалась' })];
    const groups = clusterMentions(points, [[1, 0], [1, 0], [0, 1], [0, 1]], coverage, settings);
    expect(groups.map(group => group.metrics.support)).toEqual([2, 2]);
    expect(groups.every(group => new Set(group.points.map(item => item.defect)).size === 1)).toBe(true);
  });
  it('splits density chains whose total diameter exceeds the configured threshold', () => {
    const groups = clusterMentions([point('a'), point('b'), point('c')], [vector(0), vector(0.5), vector(1)], coverage, { ...settings, epsilon: 0.15 });
    expect(groups.map(group => group.points.length).sort()).toEqual([1, 2]);
  });
  it('keeps all isolated noise as visible signals', () => {
    const groups = clusterMentions([point('a'), point('b')], [[1, 0], [0, 1]], coverage, settings);
    expect(groups).toHaveLength(2); expect(groups.every(group => group.metrics.signal)).toBe(true);
  });
  it('selects a central representative and distinct review evidence', () => {
    const points = [point('a'), point('b'), point('c'), point('d', { reviewId: 'c' })];
    const [group] = clusterMentions(points, [vector(0), vector(0.1), vector(0.15), vector(0.2)], coverage, { ...settings, representatives: 3 });
    expect(group.representativeIds[0]).toBe('b');
    expect(new Set(group.representativeIds.map(id => points.find(item => item.id === id)!.reviewId)).size).toBe(3);
    expect(group.title).toContain('крышка заедает');
  });
  it.each([[], [0, 0], [NaN, 1], [Infinity, 1], ['x', 1]].map(value => [value]))('rejects invalid vectors %j', invalid => {
    expect(() => normalizedVector(invalid)).toThrow();
  });
  it('normalizes magnitudes and rejects inconsistent dimensions and excessive volume', () => {
    expect(normalizedVector([3, 4])).toEqual([0.6, 0.8]);
    expect(() => clusterMentions([point('a'), point('b')], [[1, 0], [1, 0, 0]], coverage, settings)).toThrow();
    expect(() => clusterMentions([point('a'), point('b')], [[1, 0], [1, 0]], coverage, { ...settings, maxMentions: 1 })).toThrow(/Слишком много/);
  });
  it('separates support, successful coverage, high ratings and positive sentiment', () => {
    const points = [point('a', { rating: null, sentiment: 'positive' }), point('b', { reviewId: 'a', rating: null }), point('c', { rating: 5, sentiment: 'negative' })];
    expect(groupMetrics(points, { total: 5, succeeded: 4, failed: 1 }, 2)).toMatchObject({ support: 2, mentionCount: 3,
      prevalence: 0.5, coverage: { ratio: 0.8, failed: 1 }, highRatingCount: 1, knownRatingCount: 1,
      highRatingShare: 1, positiveSentimentCount: 1, positiveSentimentShare: 0.5, positiveContextCount: 2 });
    expect(groupMetrics([point('a', { rating: null, sentiment: 'negative' })], coverage, 2).highRatingShare).toBeNull();
    expect(groupMetrics([point('a'), point('b', { rating: 1, sentiment: 'negative' })], coverage, 2).hidden).toBe(false);
  });
  it('matches only unambiguous exact defect evidence and does not transfer one card to two new groups', () => {
    const groups = clusterMentions([point('a'), point('b')], [[1, 0], [1, 0]], coverage, settings);
    const previous = [{ id: 'old', problemId: 'stable', scope: 'product' as const, category: 'usability' as const, defects: ['КРЫШКА ЗАЕДАЕТ!'] }];
    expect(stableMatches(groups, previous)).toEqual([{ problemId: 'stable', ambiguous: false, candidateProblemIds: ['stable'] }]);
    expect(stableMatches(groups, [...previous, { ...previous[0], id: 'another-historical-snapshot' }])[0].problemId).toBe('stable');
    expect(stableMatches([groups[0], groups[0]], previous).every(match => match.ambiguous && match.problemId === null)).toBe(true);
    expect(stableMatches(groups, [{ ...previous[0], defects: ['крышка сломалась'] }])[0].problemId).toBeNull();
  });
});
