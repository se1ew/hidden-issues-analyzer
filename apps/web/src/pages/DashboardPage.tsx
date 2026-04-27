import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  MessageSquare,
  Play,
  Sparkles,
  Star,
  TrendingDown,
  Upload,
  Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { useStats, useReviews, useHiddenIssues, useRunAnalysis } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import { ProductSelector } from '../components/ProductSelector';
import toast from 'react-hot-toast';

function getSeverity(score: number) {
  if (score >= 0.7) return { label: 'Критично', bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' };
  if (score >= 0.4) return { label: 'Важно', bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' };
  return { label: 'Низкий', bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' };
}

export function DashboardPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { selectedProductId } = useProductStore();

  const stats = useStats(selectedProductId);
  const recentReviews = useReviews({ page: 1, pageSize: 5, productId: selectedProductId });
  const issues = useHiddenIssues(selectedProductId, 1, 5);
  const runAnalysis = useRunAnalysis();

  const s = stats.data;
  const isLoading = stats.isLoading;
  const isEmpty = !isLoading && s && s.total === 0;
  const unanalyzed = s ? s.total - s.analyzed : 0;
  const needsAnalysis = !isLoading && s && s.total > 0 && unanalyzed > 0;

  const handleRunAnalysis = async () => {
    try {
      await runAnalysis.mutateAsync(undefined);
      toast.success('Анализ запущен — перейдите в «Отзывы» для отслеживания');
      navigate('/reviews');
    } catch {
      toast.error('Не удалось запустить анализ');
    }
  };

  /* ── Состояние A: нет данных ── */
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[65vh] text-center gap-6 px-4">
        <div className="h-20 w-20 rounded-3xl bg-primary-100 flex items-center justify-center">
          <Sparkles className="h-10 w-10 text-primary-600" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-neutral-800 dark:text-neutral-100">
            {user?.name ? `Привет, ${user.name.split(' ')[0]}!` : 'Добро пожаловать!'}
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 max-w-md mx-auto">
            Загрузите отзывы клиентов — AI проанализирует их и найдёт скрытые проблемы,
            которые влияют на рейтинг, но не очевидны на первый взгляд.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={() => navigate('/upload')} className="btn-primary text-base px-6 py-3 gap-2">
            <Upload className="h-5 w-5" />
            Загрузить CSV с отзывами
          </button>
          <button onClick={() => navigate('/parsing')} className="btn-outline text-base px-6 py-3 gap-2">
            Спарсить с маркетплейса
          </button>
        </div>
        <p className="text-xs text-neutral-400">
          Поддерживаются CSV с колонками: text, rating, date
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>{user?.name ? `Привет, ${user.name.split(' ')[0]}!` : 'Обзор'}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Сводка по анализу отзывов
          </p>
        </div>
      </div>

      <ProductSelector />

      {/* ── Состояние B: нужен анализ ── */}
      {needsAnalysis && (
        <div className="card border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-200 dark:bg-amber-800 flex items-center justify-center shrink-0">
              <Zap className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </div>
            <div>
              <div className="font-semibold text-amber-900 dark:text-amber-200">
                {unanalyzed} {unanalyzed === 1 ? 'отзыв ожидает' : unanalyzed < 5 ? 'отзыва ожидают' : 'отзывов ожидают'} анализа
              </div>
              <div className="text-xs text-amber-700 dark:text-amber-400">
                Запустите AI-анализ, чтобы найти скрытые проблемы
              </div>
            </div>
          </div>
          <button
            onClick={handleRunAnalysis}
            disabled={runAnalysis.isPending}
            className="btn-primary bg-amber-500 hover:bg-amber-600 border-amber-500 shrink-0 gap-2"
          >
            <Play className="h-4 w-4" />
            Запустить анализ
          </button>
        </div>
      )}

      {/* ── Метрики ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${i === 0 ? 'card-hero opacity-60' : 'card'} animate-pulse`}>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-neutral-200" />
                <div className="space-y-2 flex-1">
                  <div className="h-2.5 bg-neutral-200 rounded w-20" />
                  <div className="h-6 bg-neutral-200 rounded w-12" />
                </div>
              </div>
            </div>
          ))
        ) : (
          <>
            <MetricCard icon={MessageSquare} label="Всего отзывов" value={s!.total.toString()} sub={`${s!.analyzed} проанализировано`} hero />
            <MetricCard icon={AlertTriangle} label="Скрытых проблем" value={s!.issuesCount.toString()} accent="warn" />
            <MetricCard icon={TrendingDown} label="Негативных" value={`${s!.negativePct.toFixed(1)}%`} accent="negative" />
            <MetricCard icon={Star} label="Средний рейтинг" value={s!.avgRating != null ? s!.avgRating.toFixed(2) : '—'} accent="positive" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Топ проблем ── */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3>Топ скрытых проблем</h3>
              <p className="text-xs text-neutral-400 mt-0.5">По оценке серьёзности AI</p>
            </div>
            <button onClick={() => navigate('/issues')} className="text-xs text-primary-600 hover:underline flex items-center gap-1">
              Все <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {issues.isLoading ? (
            <SkeletonList rows={3} />
          ) : !issues.data || issues.data.items.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-3 text-center">
              <AlertTriangle className="h-8 w-8 text-neutral-300" />
              <p className="text-sm text-neutral-400">
                {s && s.analyzed > 0
                  ? 'Проблем не найдено. Запустите пересчёт кластеров.'
                  : 'Сначала запустите анализ отзывов.'}
              </p>
              <button onClick={() => navigate(s && s.analyzed > 0 ? '/issues' : '/reviews')} className="btn-outline text-xs">
                {s && s.analyzed > 0 ? 'Пересчитать кластеры' : 'Запустить анализ'}
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {issues.data.items.slice(0, 5).map((issue) => {
                const sev = getSeverity(issue.hiddenScore);
                return (
                  <li
                    key={issue.id}
                    className="flex items-center justify-between gap-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 rounded-lg px-2 py-2 transition group"
                    onClick={() => navigate('/issues')}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`h-2 w-2 rounded-full shrink-0 ${sev.dot}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 truncate">
                          {issue.title}
                        </p>
                        <p className="text-xs text-neutral-400">{issue.size} отзывов</p>
                      </div>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${sev.bg} ${sev.text}`}>
                      {sev.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Последние отзывы ── */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3>Последние отзывы</h3>
              <p className="text-xs text-neutral-400 mt-0.5">Самые свежие поступления</p>
            </div>
            <button onClick={() => navigate('/reviews')} className="text-xs text-primary-600 hover:underline flex items-center gap-1">
              Все <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {recentReviews.isLoading ? (
            <SkeletonList rows={5} />
          ) : !recentReviews.data || recentReviews.data.items.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-3 text-center">
              <MessageSquare className="h-8 w-8 text-neutral-300" />
              <p className="text-sm text-neutral-400">Нет отзывов</p>
              <button onClick={() => navigate('/upload')} className="btn-outline text-xs gap-1">
                <Upload className="h-3.5 w-3.5" /> Загрузить
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {recentReviews.data.items.map((r) => (
                <li key={r.id} className="flex items-start gap-3">
                  <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${r.sentiment === 'positive' ? 'bg-green-500' : r.sentiment === 'negative' ? 'bg-red-500' : 'bg-neutral-300'}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-neutral-700 dark:text-neutral-300 truncate">{r.text}</p>
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
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon, label, value, sub, hero = false, accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub?: string; hero?: boolean;
  accent?: 'warn' | 'negative' | 'positive';
}) {
  const iconCls = hero ? 'bg-white/20 text-white'
    : accent === 'negative' ? 'bg-red-100 text-red-700'
    : accent === 'warn' ? 'bg-amber-100 text-amber-700'
    : accent === 'positive' ? 'bg-green-100 text-green-700'
    : 'bg-primary-100 text-primary-700';
  return (
    <div className={hero ? 'card-hero' : 'card'}>
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${iconCls}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className={`text-xs ${hero ? 'text-primary-200' : 'text-neutral-500'}`}>{label}</div>
          <div className={`text-2xl font-bold leading-tight ${hero ? 'text-white' : 'text-neutral-800 dark:text-neutral-100'}`}>{value}</div>
          {sub && <div className={`text-xs mt-0.5 ${hero ? 'text-primary-300' : 'text-neutral-400'}`}>{sub}</div>}
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
          <div className="mt-1.5 h-2 w-2 rounded-full bg-neutral-200 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-neutral-200 rounded w-full" />
            <div className="h-2.5 bg-neutral-100 rounded w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
