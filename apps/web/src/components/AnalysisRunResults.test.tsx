import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunResults } from './AnalysisRunResults';

const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock('../lib/queries', () => ({ useAnalysisInputs: mocks.query }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockReturnValue({ data: { items: [{ id: 'input', text: '😀 Но шумит', rating: null,
    analysis: { status: 'succeeded', errorCode: null, aspects: [{ name: 'шум', sentiment: 'negative' }],
      issues: [{ id: 'issue', defect: 'шум', quote: 'шумит', quoteStart: 6, quoteEnd: 11, consequences: null,
        masking: { positiveContext: true, reasons: ['positive_sentiment'] } }] } }], total: 11, pageSize: 10, offsetUnit: 'utf16' } });
});
describe('run-scoped evidence view', () => {
  it('highlights the saved quote and keeps missing ratings and consequences unknown', () => {
    const { container } = render(<AnalysisRunResults runId="run" />);
    expect(container.querySelector('mark')).toHaveTextContent('шумит');
    expect(screen.getByText(/Оценка: не указана/)).toBeInTheDocument();
    expect(screen.getByText('Последствия: не определены')).toBeInTheDocument();
    expect(screen.getByText(/положительная общая тональность/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Следующие отзывы' }));
    expect(mocks.query).toHaveBeenLastCalledWith('run', 2);
  });
  it('explains rejected evidence without showing it as a successful complaint', () => {
    mocks.query.mockReturnValue({ data: { items: [{ id: 'failed', text: 'Исходный отзыв', rating: 5,
      analysis: { status: 'failed', errorCode: 'invalid_evidence', aspects: [], issues: [] } }], total: 1, pageSize: 10, offsetUnit: 'utf16' } });
    render(<AnalysisRunResults runId="failed-run" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Результат не принят');
    expect(screen.queryByText(/не извлечены/)).not.toBeInTheDocument();
  });
  it('offers a retry when the result request fails', () => {
    mocks.query.mockReturnValue({ isError: true, refetch: mocks.refetch });
    render(<AnalysisRunResults runId="run" />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
