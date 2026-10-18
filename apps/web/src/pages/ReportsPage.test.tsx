import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsPage } from './ReportsPage';
import { useProductStore } from '../store/product.store';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), download: vi.fn(), status: 'completed', period: null as { from: string; to: string } | null }));
vi.mock('../lib/download', () => ({ downloadFile: mocks.download }));
vi.mock('../lib/queries', () => ({
  useProducts: () => ({ data: { items: [{ id: 'p', name: 'Крышка' }] } }),
  useStats: () => ({ data: { scope: { productId: 'p', runId: 'r', period: mocks.period }, runStatus: mocks.status } }),
  useReports: () => ({ data: { items: [{ id: 'old', title: 'Сохранённый', format: 'docx', createdAt: '2026-10-18' }] } }),
  useGenerateReport: () => ({ mutateAsync: mocks.generate, isPending: false }),
}));
beforeEach(() => { vi.clearAllMocks(); mocks.status = 'completed'; mocks.period = null; useProductStore.getState().setSelectedProductId('p'); useProductStore.getState().setDataScope({ runId: 'r' }); });
describe('report scope and persisted downloads', () => {
  it('submits explicit scope, period, window and selected sections', async () => {
    mocks.period = { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' };
    mocks.generate.mockResolvedValue({ id: 'new' }); render(<ReportsPage />);
    fireEvent.click(screen.getByLabelText('Цитаты и последствия'));
    fireEvent.click(screen.getByRole('button', { name: 'Сформировать и скачать' }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith({ productId: 'p', runId: 'r', period: mocks.period, format: 'pdf', title: undefined,
      sections: ['overview', 'analytics', 'aspects', 'problems', 'method'], days: 30 }));
    expect(mocks.download).toHaveBeenCalledWith('/api/reports/new/download', 'report-new.pdf');
  });
  it('downloads an existing file in its own format without generating or analyzing again', async () => {
    render(<ReportsPage />); fireEvent.click(screen.getByRole('button', { name: 'Скачать' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith('/api/reports/old/download', 'report-old.docx'));
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('disables snapshot generation while the run is active', () => {
    mocks.status = 'running'; render(<ReportsPage />);
    expect(screen.getByRole('button', { name: 'Сформировать и скачать' })).toBeDisabled();
  });
});
