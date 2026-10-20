import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsPage } from './ReportsPage';
import { useProductStore } from '../store/product.store';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), download: vi.fn(), status: 'completed', reportStatus: 'completed', retry: vi.fn(), period: null as { from: string; to: string } | null }));
vi.mock('../lib/download', () => ({ downloadFile: mocks.download }));
vi.mock('../lib/queries', () => ({
  useRetryReport: () => ({ mutateAsync: mocks.retry, isPending: false }),
  useProducts: () => ({ data: { items: [{ id: 'p', name: 'Крышка' }] } }),
  useStats: () => ({ data: { scope: { productId: 'p', runId: 'r', period: mocks.period }, runStatus: mocks.status } }),
  useReports: () => ({ data: { items: [{ id: 'old', title: 'Сохранённый', format: 'docx', status: mocks.reportStatus, createdAt: '2026-10-18' }] } }),
  useGenerateReport: () => ({ mutateAsync: mocks.generate, isPending: false }),
}));
beforeEach(() => { vi.clearAllMocks(); mocks.retry.mockResolvedValue({}); mocks.status = 'completed'; mocks.reportStatus = 'completed'; mocks.period = null; useProductStore.getState().setSelectedProductId('p'); useProductStore.getState().setDataScope({ runId: 'r' }); });
describe('report scope and persisted downloads', () => {
  it('submits explicit scope, period, window and selected sections', async () => {
    mocks.period = { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' };
    mocks.generate.mockResolvedValue({ id: 'new' }); render(<ReportsPage />);
    fireEvent.click(screen.getByLabelText('Цитаты и последствия'));
    fireEvent.click(screen.getByRole('button', { name: 'Сформировать отчёт' }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith({ productId: 'p', runId: 'r', period: mocks.period, format: 'pdf', title: undefined,
      sections: ['overview', 'analytics', 'aspects', 'problems', 'method'], days: 30 }));
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('downloads an existing file in its own format without generating or analyzing again', async () => {
    render(<ReportsPage />); fireEvent.click(screen.getByRole('button', { name: 'Скачать' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith('/api/reports/old/download', 'report-old.docx'));
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('shows queued progress and retries the stored snapshot without creating a fresh report', async () => {
    mocks.reportStatus = 'failed'; render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить формирование' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('old'));
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('disables snapshot generation while the run is active', () => {
    mocks.status = 'running'; render(<ReportsPage />);
    expect(screen.getByRole('button', { name: 'Сформировать отчёт' })).toBeDisabled();
  });
});
