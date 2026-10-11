import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../store/auth.store';
import { ProtectedRoute } from './ProtectedRoute';

beforeEach(() => useAuthStore.getState().clear());

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/private']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<p>Вход</p>} />
        <Route path="/private" element={<ProtectedRoute><p>Личные данные</p></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('отправляет анонимного пользователя на вход', () => {
    renderRoute();
    expect(screen.getByText('Вход')).toBeInTheDocument();
    expect(screen.queryByText('Личные данные')).not.toBeInTheDocument();
  });

  it('показывает страницу пользователю с сессией', () => {
    useAuthStore.setState({ user: { id: 'user-1', email: 'test@example.com', name: 'Тест' }, accessToken: 'test-token' });
    renderRoute();
    expect(screen.getByText('Личные данные')).toBeInTheDocument();
  });

  it('после выхода снова закрывает доступ', () => {
    useAuthStore.setState({ user: { id: 'user-1', email: 'test@example.com', name: 'Тест' }, accessToken: 'test-token' });
    useAuthStore.getState().clear();
    renderRoute();
    expect(screen.getByText('Вход')).toBeInTheDocument();
  });
});
