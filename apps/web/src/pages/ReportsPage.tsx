import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRetryReport, useGenerateReport, useProducts, useReports, useStats } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import { ErrorState } from '../components/QueryState';
import { apiErrorMessage } from '../lib/api';
import { downloadFile } from '../lib/download';
const sections = { overview: 'Объём, покрытие и ошибки', analytics: 'Показатели и календарные периоды', aspects: 'Аспекты и тональность', problems: 'Все группы и пользовательские статусы', evidence: 'Цитаты и последствия', method: 'Метод и ограничения' };
export function ReportsPage() {
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');
  const [title, setTitle] = useState('');
  const [included, setIncluded] = useState(Object.keys(sections));
  const [days, setDays] = useState(30);
  const [error, setError] = useState<unknown>(null);
  const { selectedProductId: productId, selectedRunId } = useProductStore();
  const retry = useRetryReport();
  const products = useProducts(), stats = useStats(productId), reports = useReports(), generate = useGenerateReport();
  const runId = selectedRunId ?? stats.data?.scope.runId;
  const product = products.data?.items.find(item => item.id === productId);
  const scope = stats.data?.scope;
  const ready = !!productId && !!runId && scope?.runId === runId && !['running', 'queued'].includes(stats.data?.runStatus ?? '') && included.length > 0;
  const download = async (id: string, extension: string) => { try { await downloadFile(`/api/reports/${id}/download`, `report-${id}.${extension}`); } catch (failure) { setError(failure); } };
  const submit = async () => {
    if (!ready) return;
    setError(null);
    try {
      await generate.mutateAsync({ format, title: title.trim() || undefined, productId, runId, period: scope?.period ?? null, sections: included, days });
      toast.success('Отчёт поставлен в очередь. Статус появится в истории.');
    } catch (failure) { setError(failure); }
  };
  return <div className="space-y-5"><header><h1>Отчёты</h1><p className="text-sm text-neutral-500 mt-1">Сохранённый снимок выбранного запуска со всеми группами. Скачивание готового файла не запускает анализ.</p></header>
    {stats.isError && <ErrorState error={stats.error} retry={stats.refetch} />}
    <section className="card space-y-4"><h2 className="text-lg">Новый отчёт</h2><p className="text-sm break-words">Товар: {product?.name ?? 'выберите товар'} · Запуск: {runId ?? 'выберите завершённый запуск'}</p><p className="text-xs break-words">Период запуска: {scope?.period ? `${scope.period.from} — ${scope.period.to}` : 'без ограничения по дате'}. Чтобы изменить область, выберите другой запуск в верхней панели.</p>
      <label className="block text-sm">Заголовок<input className="input mt-1 w-full" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder={product ? `Анализ отзывов ${product.name}` : 'Анализ отзывов'} /></label>
      <div className="flex flex-wrap gap-4"><label className="text-sm">Формат<select className="input mt-1" value={format} onChange={event => setFormat(event.target.value as 'pdf' | 'docx')}><option value="pdf">PDF</option><option value="docx">DOCX</option></select></label><label className="text-sm">Дней в календарном окне<select className="input mt-1" value={days} onChange={event => setDays(Number(event.target.value))}><option value={30}>30</option><option value={60}>60</option><option value={90}>90</option></select></label></div>
      <fieldset className="space-y-2"><legend className="text-sm font-semibold mb-2">Разделы</legend>{Object.entries(sections).map(([key, label]) => <label className="flex gap-2 text-sm" key={key}><input type="checkbox" disabled={key === 'method'} checked={included.includes(key)} onChange={event => setIncluded(values => event.target.checked ? [...values, key] : values.filter(value => value !== key))} />{label}</label>)}</fieldset>
      <p className="text-xs text-neutral-500">Идентификатор области, модель и ограничения включаются всегда. Числа и пользовательские решения фиксируются на момент формирования.</p>
      {!ready && <p className="text-sm">Выберите товар, завершённый запуск и хотя бы один раздел.</p>}
      {error != null && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{apiErrorMessage(error)}</p>}
      <button className="btn-primary" disabled={!ready || generate.isPending} onClick={() => void submit()}>{generate.isPending ? 'Формирование отчёта…' : 'Сформировать отчёт'}</button>
    </section>
    <section className="card space-y-3"><h2 className="text-lg">История отчётов</h2>{reports.isError ? <ErrorState error={reports.error} retry={reports.refetch} /> : reports.isPending ? <p role="status">Загрузка…</p> : !reports.data.items.length ? <p>Готовых отчётов пока нет.</p> : <ul className="space-y-3">{reports.data.items.map(report => <li className="flex flex-wrap gap-3 justify-between border-t border-neutral-200 dark:border-neutral-700 pt-3" key={report.id}><div className="min-w-0"><p className="font-semibold break-words">{report.title}</p><p className="text-xs text-neutral-500">{report.format.toUpperCase()} · {new Date(report.createdAt).toLocaleString('ru-RU')}</p><p className="text-xs text-neutral-500 break-words">{report.legacy ? 'Старый отчёт без сохранённой области' : `Товар: ${report.productId ?? '—'} · Запуск: ${report.runId ?? '—'}`}</p></div><div className="space-y-2"><p role="status" className="text-sm">{{ queued: 'Ожидает worker', running: 'Формирование', completed: 'Готов', failed: 'Ошибка формирования', expired: 'Файл удалён по сроку хранения' }[report.status ?? 'completed']}</p>
        {report.errorCode && <p className="text-xs text-neutral-500">{report.errorCode === 'report_timeout' ? 'Превышено время. Уменьшите число разделов или объём запуска.' : 'Проверьте доступность worker и свободное место. Снимок сохранён.'}</p>}
        {(!report.status || report.status === 'completed') && <button className="btn-outline" onClick={() => void download(report.id, report.format)}>Скачать</button>}
        {['failed', 'expired'].includes(report.status ?? '') && <button className="btn-outline" disabled={retry.isPending || (report.status === 'failed' && (report.attemptCount ?? 0) >= 3)} onClick={() => { void retry.mutateAsync(report.id).catch(setError); }}>{report.status === 'expired' ? 'Восстановить файл' : 'Повторить формирование'}</button>}</div></li>)}</ul>}</section>
  </div>;
}
