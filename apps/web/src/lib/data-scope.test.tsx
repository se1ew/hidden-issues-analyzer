import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStats, useReviews, useTimeseries } from './queries';
import { useGroupings } from './grouping-queries';
import { useAuthStore } from '../store/auth.store';
import { useProductStore } from '../store/product.store';
import { api } from './api';
vi.mock('./api', () => ({ api: { get: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'owner', email: 'owner@test.local' } });
  useProductStore.getState().setSelectedProductId('p');
  vi.mocked(api.get).mockResolvedValue({ data: { total: 0, items: [] } });
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
describe('owner and data scope query contracts', () => {
  it('passes the same run and period to overview, reviews and charts', async () => {
    const from = '2026-10-01T00:00:00Z', to = '2026-11-01T00:00:00Z';
    useProductStore.getState().setDataScope({ runId: 'r', from, to });
    const { wrapper, client } = setup();
    renderHook(() => { useStats('p'); useReviews({ productId: 'p', page: 1, pageSize: 25 }); useTimeseries({ productId: 'p' }); }, { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
    for (const [, config] of vi.mocked(api.get).mock.calls) expect(config?.params).toMatchObject({ productId: 'p', runId: 'r', from, to });
    expect(client.getQueryCache().getAll().every(query => JSON.stringify(query.queryKey).includes('owner'))).toBe(true);
  });
  it('separates accounts in cache even for the same product and run identifiers', async () => {
    const { wrapper, client } = setup();
    renderHook(() => useStats('p'), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    act(() => useAuthStore.setState({ user: { id: 'other', email: 'other@test.local' } }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(client.getQueryCache().getAll().map(query => query.queryKey[1])).toEqual(['owner', 'other']);
  });
  it('resets run and period when switching products and never reuses a previous scope', () => {
    useProductStore.getState().setDataScope({ runId: 'old-run', from: 'old-from', to: 'old-to' });
    useProductStore.getState().setSelectedProductId('new-product');
    expect(useProductStore.getState()).toMatchObject({ selectedProductId: 'new-product', selectedRunId: null, from: null, to: null });
  });
  it('sends server filters and changes query key when sorting or paging', async () => {
    const { wrapper, client } = setup();
    const { rerender } = renderHook(({ page, minSupport }) => useGroupings('p', 'r', '', page, { minSupport, sort: 'priority' }),
      { wrapper, initialProps: { page: 1, minSupport: 2 } });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    rerender({ page: 2, minSupport: 3 });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(api.get).toHaveBeenLastCalledWith('/api/issues/groupings', { params: expect.objectContaining({ productId: 'p', runId: 'r', page: 2, minSupport: 3, sort: 'priority' }) });
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });
});
