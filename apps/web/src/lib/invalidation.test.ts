import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateProductData } from './invalidation';
describe('scoped invalidation', () => {
  it('refreshes only affected live data and preserves immutable snapshots on import', async () => {
    const qc = new QueryClient();
    const keys = [ ['reviews', 'u', { productId: 'p' }], ['stats', 'u', {}], ['reviews', 'u', { productId: 'p', runId: 'r' }],
      ['reviews', 'u', { productId: 'other' }], ['reviews', 'another-owner', { productId: 'p' }], ['groupings', 'u', 'p', 'r'], ['products', 'u'] ];
    keys.forEach(key => qc.setQueryData(key, { items: [] }));
    await invalidateProductData(qc, 'u', 'p', ['reviews', 'stats', 'products'], false);
    expect(keys.map(key => qc.getQueryState(key)?.isInvalidated)).toEqual([true, true, false, false, false, false, true]);
  });
  it('refreshes problem states across publications of only the affected owner/product', async () => {
    const qc = new QueryClient();
    const a = ['groupings', 'u', 'p', 'old'], b = ['groupings', 'u', 'other', 'r'];
    qc.setQueryData(a, {}); qc.setQueryData(b, {});
    await invalidateProductData(qc, 'u', 'p', ['groupings']);
    expect(qc.getQueryState(a)?.isInvalidated).toBe(true); expect(qc.getQueryState(b)?.isInvalidated).toBe(false);
  });
});
