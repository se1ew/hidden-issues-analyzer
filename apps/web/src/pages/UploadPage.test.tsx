import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadPage } from './UploadPage';
import { useProductStore } from '../store/product.store';
const mocks = vi.hoisted(() => ({ manual: vi.fn(), run: vi.fn(), parsing: vi.fn() }));
vi.mock('../lib/queries', () => ({
  useProducts: () => ({ data: { items: [{ id: 'p', name: 'Товар' }] } }),
  useParsingHistory: () => ({ data: { items: [] } }),
  useCreateManualReview: () => ({ mutateAsync: mocks.manual, isPending: false }),
  useRunAnalysis: () => ({ mutateAsync: mocks.run, isPending: false }),
  useStartParsing: () => ({ mutateAsync: mocks.parsing, isPending: false }),
}));
vi.mock('../components/LlmStatus', () => ({ LlmStatus: () => <div>Настройки модели</div> }));
vi.mock('../components/CsvImportWizard', () => ({ CsvImportWizard: ({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) => <button onClick={() => onBusyChange(true)}>Передавать файл</button> }));
const show = (entry = '/upload') => render(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/upload" element={<UploadPage />} /><Route path="/reviews" element={<p>История анализа</p>} /></Routes></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); useProductStore.getState().setSelectedProductId('p'); });
describe('unified import workbench', () => {
  it('keeps Wildberries inside the upload flow and offers the other sources', () => {
    show('/upload?source=parsing'); expect(screen.getByRole('button', { name: 'Wildberries' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'CSV-файл' })).toBeEnabled();
    expect(screen.getByLabelText('Ссылка Wildberries')).toBeInTheDocument();
  });
  it('prevents product/source changes while CSV is being transferred', () => {
    show(); fireEvent.click(screen.getByRole('button', { name: 'Передавать файл' }));
    expect(screen.getByRole('button', { name: 'Ручной ввод' })).toBeDisabled(); expect(screen.getByLabelText('Товар *')).toBeDisabled();
  });
  it('offers analysis after manual import and opens run history only after a successful start', async () => {
    mocks.manual.mockResolvedValue({ id: 'r', productId: 'p' }); mocks.run.mockResolvedValue({ id: 'run' }); show();
    fireEvent.click(screen.getByRole('button', { name: 'Ручной ввод' })); fireEvent.change(screen.getByLabelText('Текст отзыва'), { target: { value: 'Отзыв' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить отзыв' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Запустить анализ' }));
    await screen.findByText('История анализа'); expect(mocks.run).toHaveBeenCalledOnce();
  });
});
