import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore, type User } from '../store/auth.store';

export function RegisterPage() {
  const navigate = useNavigate();
  const { setSession } = useAuthStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post<{ user: User; accessToken: string; refreshToken: string }>(
        '/api/auth/register',
        { name: name || undefined, email, password },
      );
      setSession(data);
      toast.success('Аккаунт создан!');
      navigate('/upload', { replace: true });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error ?? 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'radial-gradient(900px 700px at 20% 30%, #CFF4FF 0%, transparent 60%), radial-gradient(700px 600px at 80% 80%, #B7EFFF 0%, transparent 65%), #E5F8FF' }}
    >
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="h-14 w-14 rounded-2xl bg-primary-800 flex items-center justify-center shadow-card">
            <AlertTriangle className="h-7 w-7 text-primary-300" />
          </div>
          <div>
            <div className="text-xl font-bold text-primary-900">Hidden Issues</div>
            <div className="text-sm text-primary-600">Analyzer</div>
          </div>
        </div>

        <div className="card-hero">
          <h1 className="mb-1 text-white">Регистрация</h1>
          <p className="text-sm text-primary-300 mb-6">Создайте новый аккаунт</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-primary-300 mb-1">Имя</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="Иван Иванов"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-primary-300 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-primary-300 mb-1">Пароль</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="минимум 8 символов"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Создать аккаунт
            </button>
          </form>

          <p className="text-sm text-center text-primary-400 mt-6">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-primary-300 hover:text-white font-medium">
              Войти
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
