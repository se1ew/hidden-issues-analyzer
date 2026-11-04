import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import { apiErrorMessage } from '../lib/api';
import { LoadingSkeleton } from './ui';
export function LoadingState({ children = 'Загрузка данных…' }: { children?: React.ReactNode }) {
  return (
    <div className="card space-y-5" role="status" aria-live="polite">
      <p className="text-sm text-neutral-500">{children}</p>
      <LoadingSkeleton />
    </div>
  );
}
export function ErrorState({
  error,
  retry,
  message,
}: {
  error?: unknown;
  retry: () => unknown;
  message?: string;
}) {
  return (
    <div className="card flex flex-wrap items-center gap-4" role="alert">
      <span className="metric-icon tone-negative">
        <AlertCircle className="h-5 w-5" />
      </span>
      <p className="text-sm flex-1 min-w-[min(100%,12rem)]">
        {message ?? apiErrorMessage(error, 'Не удалось загрузить данные. Проверьте соединение.')}
      </p>
      <button className="btn-outline" onClick={() => void retry()}>
        <RefreshCw className="h-4 w-4" />
        Повторить запрос
      </button>
    </div>
  );
}
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="metric-icon tone-neutral mx-auto !h-11 !w-11">
        <Inbox className="h-5 w-5" />
      </span>
      <h2 className="text-base mt-4">{title}</h2>
      {children && <div className="text-sm text-neutral-500 mt-2 max-w-md mx-auto">{children}</div>}
    </div>
  );
}
