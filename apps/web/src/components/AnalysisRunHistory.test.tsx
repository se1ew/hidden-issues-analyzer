import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunHistory } from './AnalysisRunHistory';
import { useAnalysisStore } from '../store/analysis.store';
import type { AnalysisRunItem } from '../lib/queries';

const mocks = vi.hoisted(() => ({ history: vi.fn(), cancel: vi.fn(), on: vi.fn(), off: vi.fn() }));
vi.mock('../lib/queries', () => ({
  useAnalysisRuns: mocks.history,
  useProducts: () => ({ data: { items: [{ id: 'product', name: 'Aurora' }] } }),
  useCancelAnalysis: () => ({ mutateAsync: mocks.cancel, isPending: false }),
}));
vi.mock('../lib/socket', () => ({ connectSocket: () => ({ on: mocks.on, off: mocks.off }) }));
const run = (changes: Partial<AnalysisRunItem> = {}): AnalysisRunItem => ({
  id: 'run', runId: 'run', productId: 'product', status: 'running', stage: 'extraction',
  provider: 'local', model: 'fixture', total: 5, succeeded: 2, failed: 1, processed: 3,
  remaining: 2, stateVersion: 4, createdAt: '2026-10-12T12:00:00Z', startedAt: null,
  finishedAt: null, cancelRequestedAt: null, finishReason: null, ...changes,
});
const show = () => render(<QueryClientProvider client={new QueryClient()}><AnalysisRunHistory /></QueryClientProvider>);
beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisStore.getState().clear();
  mocks.history.mockReturnValue({ data: { items: [run()] } });
  mocks.cancel.mockResolvedValue({});
});
describe('persisted run history', () => {
  it('restores the active run and separates successes, errors and remaining inputs', () => {
    show();
    expect(screen.getByText('Успешно: 2 · Ошибки: 1 · Осталось: 2 · Всего: 5')).toBeInTheDocument();
    expect(useAnalysisStore.getState().jobId).toBe('run');
    expect(useAnalysisStore.getState().progress?.processed).toBe(3);
  });
  it('cancels the persisted run ID', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));
    expect(mocks.cancel).toHaveBeenCalledWith('run');
  });
  it('shows missing grouping without presenting partial extraction as complete', () => {
    mocks.history.mockReturnValue({ data: { items: [run({ status: 'partial', finishReason: 'grouping_pending' })] } });
    show();
    expect(screen.getByText('Частично')).toBeInTheDocument();
    expect(screen.getByText(/Группы проблем для этого запуска пока недоступны/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Остановить' })).not.toBeInTheDocument();
    expect(useAnalysisStore.getState().jobId).toBeNull();
  });
  it('retains active progress during a history network failure', () => {
    useAnalysisStore.getState().syncRun(run());
    mocks.history.mockReturnValue({ isError: true });
    show();
    expect(screen.getByRole('alert')).toHaveTextContent('продолжает работать на сервере');
    expect(useAnalysisStore.getState().jobId).toBe('run');
  });
  it('rejects an older state version and clears progress on a terminal state', () => {
    useAnalysisStore.getState().syncRun(run());
    useAnalysisStore.getState().syncRun(run({ stateVersion: 3, processed: 0 }));
    expect(useAnalysisStore.getState().progress?.processed).toBe(3);
    useAnalysisStore.getState().syncRun(run({ stateVersion: 5, status: 'cancelled' }));
    expect(useAnalysisStore.getState().progress).toBeNull();
    expect(useAnalysisStore.getState().jobId).toBeNull();
  });
});
