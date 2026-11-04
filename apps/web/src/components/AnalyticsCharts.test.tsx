import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RatingDistribution } from './AnalyticsCharts';
import { api } from '../lib/api';
import { useProductStore } from '../store/product.store';
import { useAuthStore } from '../store/auth.store';
import { queryScope } from '../lib/invalidation';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
  apiErrorMessage: () => 'Сервер недоступен',
}));
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore
    .getState()
    .setSession({ user: { id: 'owner', email: 'owner@example.invalid' }, accessToken: 'test' });
  useProductStore.getState().setSelectedProductId('product');
  useProductStore
    .getState()
    .setDataScope({ runId: 'run', from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' });
});
function show(runId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RatingDistribution productId="product" runId={runId} />
    </QueryClientProvider>,
  );
  return client;
}
describe('rating distribution scope and complete counts', () => {
  it('uses server totals, preserves the run and period, and keeps the product cache scope', async () => {
    vi.mocked(api.get).mockImplementation(async (_url, config) => ({
      data: { items: [], total: Number(config?.params.rating) * 10 },
    }));
    const client = show('run');
    expect(await screen.findByText(/150 оценок/)).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(5);
    for (const rating of [1, 2, 3, 4, 5])
      expect(api.get).toHaveBeenCalledWith('/api/reviews', {
        params: {
          productId: 'product',
          runId: 'run',
          from: '2026-10-01T00:00:00Z',
          to: '2026-11-01T00:00:00Z',
          page: 1,
          pageSize: 1,
          rating,
        },
      });
    expect(queryScope(client.getQueryCache().getAll()[0].queryKey)).toEqual(
      expect.objectContaining({ productId: 'product', runId: 'run' }),
    );
  });
  it('does not request a distribution without a resolved run', () => {
    show();
    expect(screen.getByText('Нужен результат анализа')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('shows a request failure instead of an empty distribution', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    show('run');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Сервер недоступен'));
    expect(screen.queryByText('Нет известных оценок')).not.toBeInTheDocument();
  });
});
