import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewsPage } from './ReviewsPage';
import { useProductStore } from '../store/product.store';
import { useAnalysisStore } from '../store/analysis.store';

const mocks = vi.hoisted(() => ({ reviews: vi.fn(), remove: vi.fn(), bulk: vi.fn() }));
vi.mock('../lib/queries', () => ({
  useReviews: mocks.reviews,
  useRunAnalysis: () => ({ mutateAsync: vi.fn() }),
  useCancelAnalysis: () => ({ mutate: vi.fn() }),
  useDeleteReview: () => ({ mutateAsync: mocks.remove }),
  useDeleteReviewsBulk: () => ({ mutateAsync: mocks.bulk }),
}));
vi.mock('../components/AnalysisBanner', () => ({ AnalysisBanner: () => null }));
vi.mock('../components/LlmStatus', () => ({ LlmStatus: () => null }));
vi.mock('../components/AnalysisRunHistory', () => ({ AnalysisRunHistory: () => null }));
beforeEach(() => {
  vi.clearAllMocks();
  useProductStore.getState().setSelectedProductId('p');
  useAnalysisStore.getState().clear();
  mocks.remove.mockResolvedValue(undefined);
  mocks.reviews.mockReturnValue({
    data: {
      items: [
        {
          id: 'r',
          text: 'Отзыв покупателя',
          rating: 5,
          createdAt: '2026-10-18',
          source: 'csv',
          sentiment: 'positive',
        },
      ],
      total: 75,
      pageSize: 25,
    },
  });
});
function CurrentSearch() {
  return <output aria-label="Параметры адреса">{useLocation().search}</output>;
}

const show = (entry = '/reviews') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ReviewsPage />
      <CurrentSearch />
    </MemoryRouter>,
  );
describe('review navigation and destructive actions', () => {
  it('retains a URL page and permits pagination without resetting it', () => {
    show('/reviews?page=2&search=товар');
    expect(mocks.reviews.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ page: 2, search: 'товар' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }));
    expect(mocks.reviews.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ page: 3, search: 'товар' }),
    );
  });
  it('resets the page only when the selected product or run changes', async () => {
    show('/reviews?page=3');
    act(() => useProductStore.getState().setSelectedProductId('other'));
    await waitFor(() =>
      expect(mocks.reviews.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({ page: 1, productId: 'other' }),
      ),
    );
  });
  it.each(['Infinity', '1000001', '2.5'])(
    'normalizes an invalid URL page %s and retains the filters',
    (page) => {
      show(`/reviews?page=${page}&rating=5`);
      for (const [params] of mocks.reviews.mock.calls) {
        expect(params).toEqual(expect.objectContaining({ page: 1, rating: 5 }));
      }
      expect(screen.getByLabelText('Параметры адреса')).toHaveTextContent('?rating=5');
    },
  );
  it('returns to the last available page after deleting the only item on the current page', async () => {
    const visible = mocks.reviews();
    let deleted = false;
    mocks.remove.mockImplementation(async () => {
      deleted = true;
    });
    mocks.reviews.mockImplementation(({ page }) =>
      deleted
        ? { data: { ...visible.data, total: 50, items: page === 3 ? [] : visible.data.items } }
        : visible,
    );
    show('/reviews?page=3&rating=5');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить отзыв' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() =>
      expect(mocks.reviews).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, rating: 5 }),
      ),
    );
    expect(screen.getByLabelText('Параметры адреса')).toHaveTextContent('?page=2&rating=5');
    expect(screen.getByText('Отзыв покупателя')).toBeInTheDocument();
  });
  it('requires confirmation before deleting an individual review', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить отзыв' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить отзыв' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('r'));
  });
});
