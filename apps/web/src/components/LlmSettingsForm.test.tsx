import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmSettingsForm } from './LlmSettingsForm';

const mocks = vi.hoisted(() => ({ save: vi.fn(), reset: vi.fn() }));
vi.mock('../lib/queries', () => ({ useSaveLlmConfiguration: () => ({ mutateAsync: mocks.save, reset: mocks.reset }) }));
const settings = { provider: 'local' as const, model: 'model.gguf', cloudModel: 'vendor/model',
  contextTokens: 4096, concurrency: 1, responseFormat: 'json_schema', source: 'account' as const,
  local: { managed: true, file: 'models/llm/model.gguf', state: 'missing' as const, backend: 'cpu' } };
beforeEach(() => { mocks.save.mockResolvedValue({}); });

describe('model selection form', () => {
  it('explains the missing file without requiring a cloud key', async () => {
    render(<LlmSettingsForm settings={settings} onSaved={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('пока не найден');
    expect(screen.getByText('models/llm/model.gguf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить режим анализа' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ provider: 'local', cloudModel: 'vendor/model' }));
  });
  it('sends the explicitly chosen cloud model and clears the entered key after saving', async () => {
    const onSaved = vi.fn();
    render(<LlmSettingsForm settings={settings} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('radio', { name: 'OpenRouter' }));
    expect(screen.getByText(/Тексты отзывов.*отправляться/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Модель OpenRouter'), { target: { value: 'other/model' } });
    fireEvent.change(screen.getByLabelText('API-ключ OpenRouter'), { target: { value: 'private-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить режим анализа' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledWith({ provider: 'openrouter', cloudModel: 'other/model', apiKey: 'private-key' });
    expect(screen.getByLabelText('API-ключ OpenRouter')).toHaveValue('');
  });
});
