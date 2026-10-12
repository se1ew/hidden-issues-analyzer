import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmStatus } from './LlmStatus';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), check: vi.fn(), mutate: vi.fn() }));
vi.mock('../lib/queries', () => ({ useLlmConfiguration: mocks.settings, useCheckLlm: mocks.check }));
beforeEach(() => {
  mocks.settings.mockReturnValue({ data: { provider: 'local', model: 'local-model' }, isError: false });
  mocks.check.mockReturnValue({ mutate: mocks.mutate, isPending: false, isSuccess: false, isError: false });
});

describe('model mode and availability', () => {
  it('shows local mode and performs the explicit availability check', () => {
    render(<LlmStatus />);
    expect(screen.getByText('Локально · local-model')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить доступность' }));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it('shows the explicitly configured cloud mode', () => {
    mocks.settings.mockReturnValue({ data: { provider: 'openrouter', model: 'cloud-model' } });
    render(<LlmStatus />);
    expect(screen.getByText('Облако · OpenRouter · cloud-model')).toBeInTheDocument();
  });
  it('shows the server diagnostic when the model is unavailable', () => {
    mocks.check.mockReturnValue({ mutate: mocks.mutate, isError: true,
      error: { response: { data: { error: 'Сервер модели недоступен' } } } });
    render(<LlmStatus />);
    expect(screen.getByRole('alert')).toHaveTextContent('Сервер модели недоступен');
  });
});
