import { Download, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useGenerateReport, useReports } from '../lib/queries';
import { api } from '../lib/api';

export function ReportsPage() {
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');
  const [title, setTitle] = useState('');

  const reports = useReports();
  const generate = useGenerateReport();

  const handleGenerate = async () => {
    try {
      const result = await generate.mutateAsync({
        format,
        title: title.trim() || undefined,
      });
      toast.success('Отчёт сгенерирован');
      // Запускаем скачивание сразу
      await downloadReport(result.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Не удалось сгенерировать');
    }
  };

  const downloadReport = async (id: string) => {
    try {
      const res = await api.get(`/api/reports/${id}/download`, { responseType: 'blob' });
      const blob = new Blob([res.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // имя файла берём из Content-Disposition если есть
      const cd = res.headers['content-disposition'] as string | undefined;
      const m = cd?.match(/filename="([^"]+)"/);
      a.download = m?.[1] ?? `report-${id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Не удалось скачать');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1>Отчёты</h1>
        <p className="text-sm text-neutral-400 mt-1">Сгенерируйте отчёт по результатам анализа</p>
      </div>

      <div className="card">
        <h3 className="mb-4">Сгенерировать новый отчёт</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-600 mb-2">
              Заголовок (опц.)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Отчёт за апрель 2026"
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-600 mb-2">Формат</label>
            <div className="flex gap-2">
              {(['pdf', 'docx'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`btn ${
                    format === f
                      ? 'bg-primary-300 text-neutral-700'
                      : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generate.isPending}
            className="btn-primary"
          >
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Сгенерировать и скачать
          </button>
        </div>
      </div>

      <div>
        <h2 className="mb-3">История отчётов</h2>
        {reports.isLoading ? (
          <div className="card text-center py-8">
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary-500" />
          </div>
        ) : !reports.data || reports.data.items.length === 0 ? (
          <div className="card text-sm text-neutral-400 text-center py-8 flex flex-col items-center gap-2">
            <Download className="h-8 w-8 text-neutral-300" />
            Пока нет сгенерированных отчётов
          </div>
        ) : (
          <div className="card divide-y divide-neutral-100">
            {reports.data.items.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div>
                  <div className="font-medium text-neutral-700">{r.title}</div>
                  <div className="text-xs text-neutral-400">
                    {r.format.toUpperCase()} · {new Date(r.createdAt).toLocaleString('ru-RU')}
                  </div>
                </div>
                <button
                  onClick={() => downloadReport(r.id)}
                  className="btn-outline px-3 py-1.5 text-xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  Скачать
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
