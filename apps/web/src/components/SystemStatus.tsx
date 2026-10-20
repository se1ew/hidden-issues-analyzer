import { useDiagnostics } from '../lib/queries';
import { ErrorState } from './QueryState';
import { LlmStatus } from './LlmStatus';
export function SystemStatus() {
  const query = useDiagnostics();
  return <section className="space-y-3"><div className="card space-y-3"><div className="flex flex-wrap gap-3 justify-between"><h2 className="text-lg">Диагностика приложения</h2><button className="btn-outline" onClick={() => void query.refetch()}>Обновить диагностику</button></div>
    {query.isError ? <ErrorState error={query.error} retry={query.refetch} /> : query.isPending ? <p role="status">Проверка служб…</p> : <>
      <ul className="text-sm space-y-2"><li>База данных: {query.data.database ? 'доступна' : 'недоступна — проверьте PostgreSQL'}</li><li>Очередь: {query.data.queue ? 'доступна' : 'недоступна — проверьте Redis; задания сохранены в БД'}</li><li>Обработчик: {query.data.worker ? 'работает' : 'нет свежего сигнала — запустите worker'}</li></ul>
      <p className="text-xs text-neutral-500">{query.data.model.action}</p></>}
  </div><LlmStatus /></section>;
}
