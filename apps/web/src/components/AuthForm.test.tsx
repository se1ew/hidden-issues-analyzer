import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthForm } from './AuthForm';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: { post: vi.fn() }, apiErrorMessage: (error: { response?: { data?: { message: string } } }, fallback: string) => error.response?.data?.message ?? fallback }));
beforeEach(() => { vi.clearAllMocks(); useAuthStore.getState().clear(); });
const show = (register = false) => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/login']}><Routes><Route path="/login" element={<AuthForm register={register} />} /><Route path="/upload" element={<p>Загрузка</p>} /></Routes></MemoryRouter>);
describe('cookie session forms', () => {
  it('shows the server error inline and leaves the anonymous session intact', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { code: 'unauthorized', message: 'Неверный email или пароль' } } }); show();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@test.local' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'old' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный email или пароль'); expect(useAuthStore.getState().user).toBeNull();
  });
  it('accepts only the user/access token response and opens the working page', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { user: { id: 'u', email: 'a@test.local' }, accessToken: 'access' } }); show();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@test.local' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByText('Загрузка'); expect(useAuthStore.getState().accessToken).toBe('access');
  });
  it('validates the UTF-8 byte limit before sending a registration request', async () => {
    show(true); fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@test.local' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'я'.repeat(37) } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('72 байт')); expect(api.post).not.toHaveBeenCalled();
  });
});
