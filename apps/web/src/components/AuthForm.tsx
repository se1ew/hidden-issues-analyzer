import { ScanLine, MessageSquare, EyeOff, FileCheck2, Eye, ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, apiErrorMessage } from '../lib/api';
import { useAuthStore, type Session } from '../store/auth.store';

export function AuthForm({ register = false }: { register?: boolean }) {
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    if (new TextEncoder().encode(password).length > 72) {
      setError('Пароль должен содержать не больше 72 байт UTF-8. Сократите пароль.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post<Session>(
        register ? '/api/auth/register' : '/api/auth/login',
        {
          email: email.trim(),
          password,
          ...(register && name.trim() ? { name: name.trim() } : {}),
        },
      );
      useAuthStore.getState().setSession(data);
      const target = (location.state as { from?: string } | null)?.from;
      navigate(
        !register && target?.startsWith('/') && !target.startsWith('//') ? target : '/upload',
        { replace: true },
      );
    } catch (error) {
      setError(
        apiErrorMessage(
          error,
          register
            ? 'Не удалось зарегистрироваться. Повторите запрос.'
            : 'Не удалось войти. Проверьте соединение и повторите.',
        ),
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <div className="flex items-center gap-3">
          <span className="brand-mark">
            <ScanLine className="h-5 w-5" />
          </span>
          <span className="text-xl font-bold tracking-tight">ReviewLens</span>
        </div>
        <div className="max-w-lg">
          <span className="text-xs font-semibold tracking-wider text-primary-700">
            АНАЛИТИКА ОТЗЫВОВ
          </span>
          <h2 className="text-4xl xl:text-[44px] font-semibold leading-tight tracking-tight mt-5">
            Поймите, что стоит
            <br />
            за высокой оценкой.
          </h2>
          <p className="mt-5 text-sm leading-relaxed text-neutral-500 max-w-md">
            Находите повторяющиеся жалобы, проверяйте доказательства и принимайте решения на основе
            отзывов покупателей.
          </p>
          <div className="space-y-5 mt-10">
            {[
              {
                Icon: MessageSquare,
                title: 'Все отзывы в одном месте',
                text: 'CSV, ручной ввод и Wildberries',
              },
              {
                Icon: EyeOff,
                title: 'Проблемы, которые легко упустить',
                text: 'Жалобы даже в положительных отзывах',
              },
              {
                Icon: FileCheck2,
                title: 'От вывода к доказательствам',
                text: 'Исходные цитаты и отчёты PDF / DOCX',
              },
            ].map(({ Icon, title, text }) => (
              <div key={title} className="flex gap-3">
                <span className="metric-icon bg-white/60 dark:bg-white/5 text-primary-700 shrink-0">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-neutral-500 mt-1">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          ReviewLens · Аналитика с опорой на слова покупателей
        </p>
      </aside>
      <section className="auth-form-area">
        <div className="auth-form-card">
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <span className="brand-mark">
              <ScanLine className="h-5 w-5" />
            </span>
            <span className="text-lg font-bold">ReviewLens</span>
          </div>
          <h1>{register ? 'Регистрация' : 'С возвращением'}</h1>
          <p className="text-sm text-neutral-500 mt-2 mb-8">
            {register
              ? 'Создайте аккаунт для работы со своими товарами'
              : 'Войдите, чтобы продолжить работу с отзывами'}
          </p>
          <form onSubmit={submit} className="space-y-5" aria-busy={loading}>
            {register && (
              <label className="block text-sm font-medium">
                Имя (необязательно)
                <input
                  name="name"
                  autoComplete="name"
                  className="input mt-2"
                  maxLength={100}
                  disabled={loading}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Как к вам обращаться"
                />
              </label>
            )}
            <label className="block text-sm font-medium">
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={loading}
                className="input mt-2"
                placeholder="you@company.ru"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <div>
              <label className="block text-sm font-medium" htmlFor="auth-password">
                Пароль
              </label>
              <div className="relative mt-2">
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  required
                  disabled={loading}
                  minLength={register ? 8 : 1}
                  maxLength={128}
                  className="input !pr-12"
                  aria-describedby={register ? 'password-help' : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  className="absolute right-3 top-3 text-neutral-500"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {register && (
              <p id="password-help" className="text-xs text-neutral-500">
                Минимум 8 символов, максимум 72 байта UTF-8.
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="text-sm border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 text-red-700 dark:text-red-300 rounded-lg p-3"
              >
                {error}
              </p>
            )}
            <button className="btn-primary w-full !min-h-11" disabled={loading}>
              {loading ? 'Отправка…' : register ? 'Создать аккаунт' : 'Войти'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
          <p className="text-sm text-neutral-500 mt-7 text-center">
            {register ? 'Уже есть аккаунт? ' : 'Нет аккаунта? '}
            <Link className="font-medium text-primary-700" to={register ? '/login' : '/register'}>
              {register ? 'Войти' : 'Зарегистрироваться'}
            </Link>
          </p>
          <p className="text-[11px] text-neutral-500 text-center mt-12">
            Ваши товары и данные доступны только вашему аккаунту.
          </p>
        </div>
      </section>
    </main>
  );
}
