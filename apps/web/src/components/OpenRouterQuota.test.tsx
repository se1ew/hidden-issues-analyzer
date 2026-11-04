import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterQuota } from './OpenRouterQuota';

const mocks = vi.hoisted(() => ({ limits: vi.fn(), refetch: vi.fn() }));
vi.mock('../lib/queries', () => ({ useOpenRouterLimits: mocks.limits }));
beforeEach(() => mocks.limits.mockReturnValue({ refetch: mocks.refetch, data: { checkedAt: '2026-11-04T11:00:00Z',
  freeRequests: { used: 9, remaining: 41, limit: 50, resetAt: '2026-11-05T00:00:00Z' }, keyCredits: { limit: null, remaining: null } } }));
describe('free request quota', () => {
  it('displays the real shared counter, reset policy and refresh control', () => {
    render(<OpenRouterQuota hasApiKey />);
    expect(screen.getByText('41 из 50')).toBeInTheDocument();
    expect(screen.getByText(/00:00 UTC/)).toBeInTheDocument();
    expect(screen.getByText(/Общий счётчик аккаунта/)).toBeInTheDocument();
    expect(screen.getByText(/Это не баланс аккаунта/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить лимиты' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
  it('shows an unknown remainder when the provider omits the counter', () => {
    mocks.limits.mockReturnValue({ data: { checkedAt: '2026-11-04T11:00:00Z', freeRequests: null } });
    render(<OpenRouterQuota hasApiKey />);
    expect(screen.getByText('OpenRouter не сообщил точный остаток бесплатных запросов.')).toBeInTheDocument();
    expect(screen.queryByText(/00:00 UTC/)).not.toBeInTheDocument();
  });
  it('hides a stale remainder after a refresh fails', () => {
    const current = mocks.limits();
    mocks.limits.mockReturnValue({ ...current, isError: true, error: new Error('offline') });
    render(<OpenRouterQuota hasApiKey />);
    expect(screen.queryByText('41 из 50')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/прежний остаток устарел/)).toBeInTheDocument();
  });
  it('does not fetch without a saved key', () => {
    render(<OpenRouterQuota hasApiKey={false} />);
    expect(mocks.limits).toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'Обновить лимиты' })).toBeDisabled();
    expect(screen.queryByText('41 из 50')).not.toBeInTheDocument();
  });
});
