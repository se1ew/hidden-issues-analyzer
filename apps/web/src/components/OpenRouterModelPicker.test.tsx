import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterModelPicker } from './OpenRouterModelPicker';

const mocks = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock('../lib/queries', () => ({ useOpenRouterModels: mocks.catalog }));
beforeEach(() => mocks.catalog.mockReturnValue({ data: { items: [
  { id: 'openrouter/free', name: 'Free Router', isFree: true, contextTokens: 4096, pricing: { promptPerMillion: 0, completionPerMillion: 0, request: 0 } },
  { id: 'vendor/paid', name: 'Paid model', isFree: false, contextTokens: 32000, pricing: { promptPerMillion: 1, completionPerMillion: 3, request: 0 } },
] } }));
describe('model catalog picker', () => {
  it('shows free/paid prices and filters without silently changing the selected model', () => {
    const change = vi.fn(); render(<OpenRouterModelPicker value="openrouter/free" onChange={change} />);
    expect(screen.getByRole('option', { name: /Paid model.*\$1 вход.*\$3 выход/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Стоимость'), { target: { value: 'paid' } });
    expect(screen.getByLabelText('Модель OpenRouter')).toHaveValue('openrouter/free');
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Модель OpenRouter'), { target: { value: 'vendor/paid' } });
    expect(change).toHaveBeenCalledWith('vendor/paid');
    fireEvent.change(screen.getByLabelText('Поиск модели'), { target: { value: 'absent' } });
    expect(screen.getByText('По этому фильтру модели не найдены.')).toBeInTheDocument();
  });
  it('keeps a retired saved model visible and asks for an explicit new selection', () => {
    render(<OpenRouterModelPicker value="retired/free" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Модель OpenRouter')).toHaveValue('retired/free');
    expect(screen.getByRole('alert')).toHaveTextContent('Текущей модели нет');
  });
  it('allows a manual ID and refresh when the catalog is unavailable', () => {
    const refetch = vi.fn(), change = vi.fn(); mocks.catalog.mockReturnValue({ isError: true, refetch });
    render(<OpenRouterModelPicker value="old/id" onChange={change} />);
    fireEvent.change(screen.getByLabelText('Модель OpenRouter'), { target: { value: 'manual/id' } });
    expect(change).toHaveBeenCalledWith('manual/id');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' })); expect(refetch).toHaveBeenCalledOnce();
  });
});
