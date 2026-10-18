import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IssuesPage } from './IssuesPage';
import { useProductStore } from '../store/product.store';
import type { GroupingResponse, RunGroup } from '../lib/grouping-queries';
const mocks = vi.hoisted(() => ({ groups: vi.fn(), history: vi.fn(), edit: vi.fn(), state: vi.fn(), recompute: vi.fn(), evidence: vi.fn() }));
vi.mock('../components/ProductSelector', () => ({ ProductSelector: () => <div>Выбор товара</div> }));
vi.mock('../lib/queries', () => ({ useAnalysisRuns: () => ({ data: { items: [] } }) }));
vi.mock('../lib/grouping-queries', () => ({
  useGroupings: mocks.groups, useGroupingHistory: mocks.history, useGroupEvidence: mocks.evidence,
  useEditGrouping: () => ({ mutateAsync: mocks.edit, isPending: false }),
  useSetProblemState: () => ({ mutateAsync: mocks.state, isPending: false }),
  useRecomputeGrouping: () => ({ mutateAsync: mocks.recompute, isPending: false }),
}));
const group = (id: string): RunGroup => ({ id, title: `Шум ${id}`, defect: 'шум', category: 'functionality', scope: 'product', needsReview: false,
  mentionIds: [`${id}-1`, `${id}-2`], representatives: [{ id: `${id}-1`, defect: 'шум', quote: 'шумит', quoteStart: 0, quoteEnd: 5, text: 'шумит', rating: null, sentiment: 'positive', reviewId: 'r', consequences: null }],
  candidateProblems: [], problem: { id: `problem-${id}`, status: 'new', stateVersion: 2, events: [] }, metrics: { support: 2, mentionCount: 3, prevalence: 0.5, signal: false, hidden: true, positiveContextCount: 2,
    highRatingCount: 1, knownRatingCount: 1, highRatingShare: 1, positiveSentimentCount: 1, sentimentDenominator: 2, positiveSentimentShare: 0.5,
    coverage: { total: 5, succeeded: 4, failed: 1, remaining: 0, ratio: 0.8 } } });
const data = (): GroupingResponse => ({ items: [group('a'), group('b')], total: 2, pageSize: 20, currentPublicationId: 'pub',
  publication: { id: 'pub', runId: 'run', createdAt: '2026-10-18T10:00:00Z', sourceId: null, run: { total: 5, succeeded: 4, failed: 1, status: 'partial' } } });
beforeEach(() => {
  vi.clearAllMocks(); useProductStore.getState().setSelectedProductId('product');
  mocks.groups.mockReturnValue({ data: data() }); mocks.history.mockReturnValue({ data: { items: [] } });
  mocks.edit.mockResolvedValue({ committed: false, publicationId: 'pub', preview: [{ title: 'Объединённая группа', metrics: { support: 4 } }] });
  mocks.evidence.mockReturnValue({ data: { items: [group('a').representatives[0]], total: 1, pageSize: 10, offsetUnit: 'utf16' } });
});
describe('run-scoped problems and owner corrections', () => {
  it('displays the versioned rule, explicit consequence category and insufficient evidence', () => {
    const response = data();
    response.items[0].metrics.signal = true;
    response.items[0].metrics.priority = { version: 'support-masking-consequence-v1', score: 200020, explanation: 'Сначала поддержка, затем положительный контекст', evidenceLabel: 'Мало подтверждений', limitation: 'Вероятность и критичность не измерены' };
    response.items[0].metrics.consequences = [{ mentionId: 'a-1', text: 'получил ожог', quote: 'нагревался, получил ожог', category: 'reported_harm' }];
    mocks.groups.mockReturnValue({ data: response }); render(<IssuesPage />);
    expect(screen.getByText(/Мало подтверждений. Достоверность не измерена/)).toBeInTheDocument();
    expect(screen.getByText(/Автор сообщает о вреде/)).toBeInTheDocument();
    expect(screen.getByText(/Правило: support-masking-consequence-v1/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Минимум отзывов'), { target: { value: '3' } });
    expect(mocks.groups).toHaveBeenLastCalledWith('product', '', '', 1, expect.objectContaining({ minSupport: 3 }));
  });
  it('displays independent denominators and missing consequences', () => {
    render(<IssuesPage />);
    expect(screen.getAllByText(/Распространённость: 2\/4 \(50.0%\)/)).toHaveLength(2);
    expect(screen.getAllByText(/4–5 у 1\/1 \(100.0%\)/)).toHaveLength(2);
    expect(screen.getAllByText(/Последствия: не определены/)).toHaveLength(2);
    expect(screen.queryByText('Критично')).not.toBeInTheDocument();
  });
  it('previews a merge and commits only after confirmation', async () => {
    render(<IssuesPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать группу: Шум a' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать группу: Шум b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Объединить выбранные (2)' }));
    await screen.findByRole('region', { name: 'Предпросмотр группировки' });
    expect(mocks.edit).toHaveBeenCalledTimes(1);
    expect(mocks.edit).toHaveBeenLastCalledWith({ publicationId: 'pub', input: expect.objectContaining({ commit: false, expectedPublicationId: 'pub', change: { kind: 'merge', snapshotIds: ['a', 'b'] } }) });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    await waitFor(() => expect(mocks.edit).toHaveBeenLastCalledWith({ publicationId: 'pub', input: expect.objectContaining({ commit: true }) }));
  });
  it('requires an explanation for rejection and sends the card version', () => {
    render(<IssuesPage />);
    expect(screen.getAllByRole('button', { name: 'Отклонить' })[0]).toBeDisabled();
    fireEvent.change(screen.getAllByLabelText('Комментарий к решению')[0], { target: { value: 'Не подтверждается' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Отклонить' })[0]);
    expect(mocks.state).toHaveBeenCalledWith({ id: 'problem-a', status: 'rejected', expectedVersion: 2, reason: 'Не подтверждается' });
  });
  it('shows singleton signals and historical results without editable state controls', () => {
    const response = data(); response.currentPublicationId = 'newer'; response.items[0].metrics.signal = true;
    mocks.groups.mockReturnValue({ data: response }); render(<IssuesPage />);
    expect(screen.getByText(/Неподтверждённый сигнал/)).toBeInTheDocument();
    expect(screen.getByText(/Открыта историческая публикация/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Подтвердить' })).not.toBeInTheDocument();
  });
  it('requires a product and does not render cached groups from another selection', () => {
    useProductStore.setState({ selectedProductId: null }); render(<IssuesPage />);
    expect(screen.getByText('Выберите товар для просмотра проблем.')).toBeInTheDocument();
    expect(mocks.groups).not.toHaveBeenCalled();
  });
});
