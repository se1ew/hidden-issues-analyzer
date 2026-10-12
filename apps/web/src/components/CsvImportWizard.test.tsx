import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CsvImportWizard } from './CsvImportWizard';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), upload: vi.fn() }));
vi.mock('../lib/queries', () => ({
  usePreviewCsv: () => ({ mutateAsync: mocks.preview, isPending: false }),
  useUploadCsv: () => ({ mutateAsync: mocks.upload, isPending: false }),
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const preview = {
  headers: ['text', 'rating'], delimiter: ',', mapping: { text: 'text', rating: 'rating' },
  totalCount: 2, validCount: 1, errorCount: 1,
  errors: [{ rowNumber: 3, field: 'rating', message: 'Оценка должна быть целым числом от 1 до 5' }],
  errorsTruncated: false, sample: [{ rowNumber: 2, values: ['Исходный текст', '5'] }],
};
const imported = { count: 1, batchId: 'batch', productId: 'product', totalCount: 2,
  validCount: 1, skippedCount: 0, errorCount: 1, status: 'partial' };

beforeEach(() => {
  mocks.preview.mockResolvedValue(preview);
  mocks.upload.mockResolvedValue(imported);
});

async function selectFile(container: HTMLElement) {
  const file = new File(['text,rating\nИсходный текст,5\nОшибка,8'], 'reviews.csv', { type: 'text/csv' });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await screen.findByText('Исходный текст');
  return file;
}

describe('CSV import confirmation', () => {
  it('previews before writing and shows partial counts and the error download', async () => {
    const onImported = vi.fn();
    const { container } = render(<CsvImportWizard productId="product" onImported={onImported} />);
    const file = await selectFile(container);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(screen.getByText(/С ошибками: 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать корректные записи' }));
    await screen.findByText('Импорт завершён с ошибками строк');
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ file, productId: 'product', mapping: preview.mapping }));
    expect(onImported).toHaveBeenCalledWith(imported);
    expect(screen.getByRole('button', { name: 'Скачать ошибки CSV' })).toBeInTheDocument();
  });

  it('requires a selected or newly named product', async () => {
    const { container, rerender } = render(<CsvImportWizard onImported={vi.fn()} />);
    await selectFile(container);
    expect(screen.getByRole('button', { name: 'Импортировать корректные записи' })).toBeDisabled();
    rerender(<CsvImportWizard productName="Новый товар" onImported={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Импортировать корректные записи' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать корректные записи' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ productName: 'Новый товар' })));
  });

  it('invalidates confirmation after mapping changes and rechecks before import', async () => {
    const { container } = render(<CsvImportWizard productId="product" onImported={vi.fn()} />);
    await selectFile(container);
    fireEvent.change(screen.getByLabelText('Оценка'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Импортировать корректные записи' })).toBeDisabled();
    mocks.preview.mockResolvedValue({ ...preview, mapping: { text: 'text', rating: '' }, validCount: 2, errorCount: 0, errors: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить строки' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Импортировать корректные записи' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать корректные записи' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ mapping: { text: 'text', rating: '' } })));
  });

  it('does not allow import when no valid records remain', async () => {
    mocks.preview.mockResolvedValue({ ...preview, validCount: 0, errorCount: 2 });
    const { container } = render(<CsvImportWizard productId="product" onImported={vi.fn()} />);
    await selectFile(container);
    expect(screen.getByRole('button', { name: 'Импортировать корректные записи' })).toBeDisabled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
