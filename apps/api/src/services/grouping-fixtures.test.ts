import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clusterMentions, type GroupingPoint } from './grouping-engine.js';
import { GroupingSettingsSchema } from '../schemas/grouping.schema.js';

interface ReviewCase { id: string; productId: string; text: string; rating: number | null;
  expected: { sentiments: GroupingPoint['sentiment'][]; issues: Array<{ defect: string; aspect: GroupingPoint['category']; scope: GroupingPoint['scope']; quote: string }> } }
interface Expected { productId: string; defect: string; reviewIds: string[]; hidden: boolean }
const fixtures = JSON.parse(readFileSync(new URL('../../../../docs/fixtures/review-cases.json', import.meta.url), 'utf8')) as { cases: ReviewCase[]; expectedProductGroups: Expected[] };

describe('grouping of annotated fixtures with controlled semantic vectors', () => {
  it('matches all eight product groups and four hidden groups without confusing different defects', () => {
    const allGroups: ReturnType<typeof clusterMentions> = [];
    const defects = [...new Set(fixtures.cases.flatMap(review => review.expected.issues.map(issue => issue.defect)))];
    for (const productId of new Set(fixtures.cases.map(review => review.productId))) {
      const reviews = fixtures.cases.filter(review => review.productId === productId);
      const points = reviews.flatMap(review => review.expected.issues.map((issue, index): GroupingPoint => ({
        id: `${review.id}-${index}`, reviewId: review.id, productId, runId: `run-${productId}`, inputHash: review.id,
        defect: issue.defect, quote: issue.quote, quoteStart: review.text.indexOf(issue.quote), quoteEnd: review.text.indexOf(issue.quote) + issue.quote.length,
        category: issue.aspect, aspect: issue.aspect, scope: issue.scope, rating: review.rating,
        sentiment: review.expected.sentiments[0], importedAt: new Date(0), consequences: null,
      })));
      // The labels define deterministic vectors. This tests grouping mechanics, not the embedding model's quality.
      const vectors = points.map(point => defects.map(defect => defect === point.defect ? 1 : 0));
      const groups = clusterMentions(points, vectors, { total: reviews.length, succeeded: reviews.length, failed: 0 }, GroupingSettingsSchema.parse({}));
      expect(groups.flatMap(group => group.points)).toHaveLength(points.length);
      allGroups.push(...groups.filter(group => group.scope === 'product'));
    }
    expect(allGroups).toHaveLength(8);
    for (const expected of fixtures.expectedProductGroups) {
      const group = allGroups.find(group => group.points[0].productId === expected.productId && group.defect === expected.defect)!;
      expect([...new Set(group.points.map(point => point.reviewId))].sort()).toEqual([...expected.reviewIds].sort());
      expect(group.metrics.hidden).toBe(expected.hidden);
    }
    expect(allGroups.filter(group => group.metrics.hidden)).toHaveLength(4);
  });
});
