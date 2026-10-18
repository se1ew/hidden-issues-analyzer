import { apiErrorMessage } from '../lib/api';
export function LoadingState({ children = 'Загрузка данных…' }: { children?: React.ReactNode }) {
  return <div className="card text-sm" role="status" aria-live="polite">{children}</div>;
}
export function ErrorState({ error, retry, message }: { error?: unknown; retry: () => unknown; message?: string }) {
  return <div className="card space-y-3" role="alert"><p>{message ?? apiErrorMessage(error, 'Не удалось загрузить данные. Проверьте соединение.')}</p>
    <button className="btn-outline" onClick={() => void retry()}>Повторить запрос</button></div>;
}
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="card py-10 text-center space-y-2"><h2 className="text-base">{title}</h2>{children && <p className="text-sm text-neutral-500">{children}</p>}</div>;
}
