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
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background:
          'radial-gradient(ellipse 1100px 800px at -5% -5%, #B8D8F5 0%, transparent 55%), radial-gradient(ellipse 800px 700px at 105% 105%, #C0DCF8 0%, transparent 55%), #D3E9F8',
      }}
    >
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div
            className="h-12 w-12 rounded-2xl flex items-center justify-center shadow-md"
            style={{ background: '#1E3248' }}
          >
            <AlertTriangle className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="text-xl font-bold" style={{ color: '#1A2D40' }}>Hidden Issues</div>
            <div className="text-sm" style={{ color: '#7A96B0' }}>Analyzer</div>
          </div>
        </div>

        <div className="card">
          <h1 className="mb-1" style={{ color: '#1A2D40' }}>Регистрация</h1>
          <p className="text-sm mb-6" style={{ color: '#7A96B0' }}>Создайте новый аккаунт</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#3A5870' }}>Имя</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="Иван Иванов"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#3A5870' }}>Email</label>
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
              <label className="block text-sm font-medium mb-1" style={{ color: '#3A5870' }}>Пароль</label>
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
            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Создать аккаунт
            </button>
          </form>

          <p className="text-sm text-center mt-6" style={{ color: '#7A96B0' }}>
            Уже есть аккаунт?{' '}
            <Link to="/login" className="font-semibold hover:underline" style={{ color: '#255AAE' }}>
              Войти
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
