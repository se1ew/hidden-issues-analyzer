import {
  AlertTriangle,
  BarChart3,
  Globe,
  MessageSquare,
  Play,
  Star,
  TrendingDown,
  Upload,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { useStats, useReviews, useHiddenIssues } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import { ProductSelector } from '../components/ProductSelector';

export function DashboardPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { selectedProductId } = useProductStore();

  const stats = useStats(selectedProductId);
  const recentReviews = useReviews({ page: 1, pageSize: 5, productId: selectedProductId });
  const issues = useHiddenIssues(selectedProductId);

  const s = stats.data;

  const quickActions = [
    { label: 'Загрузить отзывы', icon: Upload, to: '/upload', color: 'bg-primary-100 text-primary-800' },
    { label: 'Запустить анализ', icon: Play, to: '/reviews', color: 'bg-green-100 text-green-800' },
    { label: 'Аналитика', icon: BarChart3, to: '/analytics', color: 'bg-blue-100 text-blue-800' },
    { label: 'Парсинг', icon: Globe, to: '/parsing', color: 'bg-purple-100 text-purple-800' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1>
          {user?.name ? `Привет, ${user.name.split(' ')[0]}!` : 'Главная'}
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          Сводка по анализу отзывов
        </p>
      </div>

      {/* Key metrics */}
      <ProductSelector />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${i === 0 ? 'card-hero opacity-60' : 'card'} animate-pulse`}>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/30" />
                <div className="space-y-2">
                  <div className="h-2.5 bg-white/30 rounded w-20" />
                  <div className="h-6 bg-white/30 rounded w-12" />
                </div>
              </div>
            </div>
          ))
        ) : (
          <>
            <MetricCard
              icon={MessageSquare}
              label="Всего отзывов"
              value={s ? s.total.toString() : '—'}
              sub={s ? `из них ${s.analyzed} проанализировано` : undefined}
              hero
            />
            <MetricCard
              icon={AlertTriangle}
              label="Скрытых проблем"
              value={s ? s.issuesCount.toString() : '—'}
              accent="warn"
            />
            <MetricCard
              icon={TrendingDown}
              label="Негативных"
              value={s ? `${s.negativePct.toFixed(1)}%` : '—'}
              accent="negative"
            />
            <MetricCard
              icon={Star}
              label="Средний рейтинг"
              value={s?.avgRating != null ? s.avgRating.toFixed(2) : '—'}
              accent="positive"
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <div className="card">
        <h3 className="mb-4">Быстрые действия</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions.map(({ label, icon: Icon, to, color }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className={`flex flex-col items-center gap-2 rounded-xl p-4 text-sm font-medium transition-all hover:opacity-80 ${color}`}
            >
              <Icon className="h-6 w-6" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent reviews */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3>Последние отзывы</h3>
            <button onClick={() => navigate('/reviews')} className="text-xs text-primary-600 hover:underline">
              Все →
            </button>
          </div>
          {recentReviews.isLoading ? (
            <SkeletonList rows={5} />
          ) : !recentReviews.data || recentReviews.data.items.length === 0 ? (
            <p className="text-sm text-neutral-400 py-4 text-center">Нет отзывов</p>
          ) : (
            <ul className="space-y-3">
              {recentReviews.data.items.map((r) => (
                <li key={r.id} className="flex items-start gap-3">
                  <span
                    className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                      r.sentiment === 'positive'
                        ? 'bg-green-500'
                        : r.sentiment === 'negative'
                          ? 'bg-red-500'
                          : 'bg-neutral-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-neutral-700 dark:text-neutral-300 truncate">
                      {r.text}
                    </p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {r.rating ? `★ ${r.rating} · ` : ''}
                      {new Date(r.createdAt).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top issues */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3>Топ скрытых проблем</h3>
            <button onClick={() => navigate('/issues')} className="text-xs text-primary-600 hover:underline">
              Все →
            </button>
          </div>
          {issues.isLoading ? (
            <SkeletonList rows={3} />
          ) : !issues.data || issues.data.items.length === 0 ? (
            <p className="text-sm text-neutral-400 py-4 text-center">
              Нет кластеров. Запустите анализ и пересчитайте проблемы.
            </p>
          ) : (
            <ul className="space-y-3">
              {issues.data.items.slice(0, 5).map((issue) => (
                <li
                  key={issue.id}
                  className="flex items-center justify-between gap-3 cursor-pointer hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg px-2 py-1.5 transition"
                  onClick={() => navigate('/issues')}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 truncate">
                      {issue.title}
                    </p>
                    <p className="text-xs text-neutral-400">{issue.size} отзывов</p>
                  </div>
                  <span className="text-lg font-bold text-primary-700 shrink-0">
                    {(issue.hiddenScore * 100).toFixed(0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  hero = false,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  hero?: boolean;
  accent?: 'warn' | 'negative' | 'positive';
}) {
  const iconCls = hero
    ? 'bg-white/20 text-white'
    : accent === 'negative'
      ? 'bg-red-100 text-red-700'
      : accent === 'warn'
        ? 'bg-amber-100 text-amber-700'
        : accent === 'positive'
          ? 'bg-green-100 text-green-700'
          : 'bg-primary-100 text-primary-700';
  return (
    <div className={hero ? 'card-hero' : 'card'}>
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${iconCls}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className={`text-xs ${hero ? 'text-primary-300' : 'text-neutral-500'}`}>{label}</div>
          <div className={`text-2xl font-bold ${hero ? 'text-white' : 'text-neutral-800 dark:text-neutral-100'}`}>
            {value}
          </div>
          {sub && (
            <div className={`text-xs mt-0.5 ${hero ? 'text-primary-300' : 'text-neutral-400'}`}>{sub}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 animate-pulse">
          <div className="mt-1 h-2 w-2 rounded-full bg-neutral-200 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-neutral-200 rounded w-full" />
            <div className="h-2.5 bg-neutral-100 rounded w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
