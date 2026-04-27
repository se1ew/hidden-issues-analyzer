import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore, type User } from '../store/auth.store';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setSession } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from || '/upload';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post<{ user: User; accessToken: string; refreshToken: string }>(
        '/api/auth/login',
        { email, password },
      );
      setSession(data);
      toast.success('Добро пожаловать!');
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error ?? 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: 'radial-gradient(900px 700px at 20% 30%, #CFF4FF 0%, transparent 60%), radial-gradient(700px 600px at 80% 80%, #B7EFFF 0%, transparent 65%), #E5F8FF',
      }}
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
          <h1 className="mb-1 text-white">Вход в систему</h1>
          <p className="text-sm text-primary-300 mb-6">Введите email и пароль</p>

          <form onSubmit={handleSubmit} className="space-y-4">
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
                placeholder="••••••••"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Войти
            </button>
          </form>

          <p className="text-sm text-center text-primary-400 mt-6">
            Нет аккаунта?{' '}
            <Link to="/register" className="text-primary-300 hover:text-white font-medium">
              Зарегистрируйтесь
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
