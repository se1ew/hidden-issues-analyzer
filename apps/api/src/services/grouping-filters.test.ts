import { describe, expect, it } from 'vitest';
import { GroupingQuerySchema } from '../schemas/grouping.schema.js';
import { filterAndSortGroups } from './grouping-filters.js';
const rows = [
  { id: 'b', category: 'quality', reviewCount: 3, positiveContextCount: 1, metrics: { signal: false, priority: { score: 300010 } }, problem: { status: 'new' } },
  { id: 'a', category: 'quality', reviewCount: 3, positiveContextCount: 3, metrics: { signal: false, priority: { score: 300030 } }, problem: { status: 'confirmed' } },
  { id: 'c', category: 'material', reviewCount: 1, positiveContextCount: 0, metrics: { signal: true }, problem: null },
];
const query = (more = {}) => GroupingQuerySchema.parse({ productId: 'p', ...more });
describe('server grouping filters', () => {
  it('sorts the complete selection by saved versioned priority with stable ties', () => {
    expect(filterAndSortGroups([...rows, { ...rows[0], id: 'd' }], query()).map(row => row.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(filterAndSortGroups(rows, query({ sort: 'support', direction: 'asc' })).map(row => row.id)).toEqual(['c', 'a', 'b']);
  });
  it('combines aspect, state, support, masking and priority before pagination', () => {
    expect(filterAndSortGroups(rows, query({ category: 'quality', status: 'confirmed', minSupport: 2, minMasking: 0.5, minPriority: 300020 })).map(row => row.id)).toEqual(['a']);
    expect(filterAndSortGroups(rows, query({ status: 'signal' })).map(row => row.id)).toEqual(['c']);
    expect(filterAndSortGroups(rows, query({ minSupport: 4 }))).toEqual([]);
  });
  it.each([{ pageSize: 101 }, { page: 1.5 }, { minMasking: 2 }, { minSupport: 0 }, { category: 'invalid' }, { sort: 'secret' }, { from: '2026-10-01T00:00:00Z' }])('rejects invalid query %j', input => {
    expect(() => query(input)).toThrow();
  });
});
