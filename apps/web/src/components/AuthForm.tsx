import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, apiErrorMessage } from '../lib/api';
import { useAuthStore, type Session } from '../store/auth.store';

export function AuthForm({ register = false }: { register?: boolean }) {
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const navigate = useNavigate(); const location = useLocation();
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (loading) return;
    if (new TextEncoder().encode(password).length > 72) { setError('Пароль должен содержать не больше 72 байт UTF-8. Сократите пароль.'); return; }
    setLoading(true); setError('');
    try {
      const { data } = await api.post<Session>(register ? '/api/auth/register' : '/api/auth/login', { email: email.trim(), password,
        ...(register && name.trim() ? { name: name.trim() } : {}) });
      useAuthStore.getState().setSession(data);
      const target = (location.state as { from?: string } | null)?.from;
      navigate(!register && target?.startsWith('/') && !target.startsWith('//') ? target : '/upload', { replace: true });
    } catch (error) { setError(apiErrorMessage(error, register ? 'Не удалось зарегистрироваться. Повторите запрос.' : 'Не удалось войти. Проверьте соединение и повторите.')); }
    finally { setLoading(false); }
  };
  return <main className="min-h-dvh flex items-center justify-center p-4"><div className="w-full max-w-md space-y-6">
    <div><p className="font-semibold text-lg">ReviewLens</p><p className="text-sm text-neutral-500">Анализ отзывов о товарах</p></div>
    <div className="card"><h1>{register ? 'Регистрация' : 'Вход в систему'}</h1><p className="text-sm text-neutral-500 mt-2 mb-5">{register ? 'Создайте аккаунт для работы со своими товарами' : 'Войдите, чтобы продолжить работу'}</p>
      <form onSubmit={submit} className="space-y-4" aria-busy={loading}>
        {register && <label className="block text-sm">Имя (необязательно)<input name="name" autoComplete="name" className="input mt-1" maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>}
        <label className="block text-sm">Email<input name="email" type="email" autoComplete="username" required className="input mt-1" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="block text-sm">Пароль<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : 1} maxLength={128} className="input mt-1" aria-describedby={register ? 'password-help' : undefined} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {register && <p id="password-help" className="text-xs text-neutral-500">Минимум 8 символов, максимум 72 байта UTF-8.</p>}
        {error && <p role="alert" className="text-sm border border-red-400 rounded-lg p-3">{error}</p>}
        <button className="btn-primary w-full" disabled={loading}>{loading ? 'Отправка…' : register ? 'Создать аккаунт' : 'Войти'}</button>
      </form>
      <p className="text-sm mt-5">{register ? 'Уже есть аккаунт? ' : 'Нет аккаунта? '}<Link className="underline" to={register ? '/login' : '/register'}>{register ? 'Войти' : 'Зарегистрироваться'}</Link></p>
    </div>
  </div></main>;
}
