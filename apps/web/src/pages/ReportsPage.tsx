import { Download, FileText, Loader2 } from 'lucide-react';
import { ProductSelector } from '../components/ProductSelector';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useGenerateReport, useProducts, useReports } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import { api } from '../lib/api';

export function ReportsPage() {
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');
  const [title, setTitle] = useState('');

  const { selectedProductId } = useProductStore();
  const products = useProducts();

  const selectedProduct = products.data?.items.find((p) => p.id === selectedProductId);
  const autoTitle = (() => {
    const date = new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    const productName = selectedProduct?.name;
    return productName ? `${productName} — ${date}` : `Отчёт ${date}`;
  });

  const reports = useReports();
  const generate = useGenerateReport();

  const handleGenerate = async () => {
    try {
      const result = await generate.mutateAsync({ format, title: title.trim() || undefined });
      toast.success('Отчёт сгенерирован');
      await downloadReport(result.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Не удалось сгенерировать');
    }
  };

  const downloadReport = async (id: string) => {
    try {
      const res = await api.get<Blob>(`/api/reports/${id}/download`, { responseType: 'blob' });
      // res.data is already a Blob when responseType:'blob'
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers['content-disposition'] as string | undefined;
      const m = cd?.match(/filename="([^"]+)"/);
      a.download = m?.[1] ?? `report-${id}.${format}`;
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
        <p className="text-sm text-primary-600 dark:text-primary-400 mt-1">
          Сгенерируйте PDF или DOCX-отчёт по результатам анализа
        </p>
      </div>

      <ProductSelector />

      <div className="card-hero">
        <h3 className="mb-4 text-white">Сгенерировать новый отчёт</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-primary-300 mb-2">
              Заголовок (опц.)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={autoTitle()}
                className="input flex-1"
              />
              <button
                type="button"
                onClick={() => setTitle(autoTitle())}
                className="btn-outline px-3 py-2 text-xs whitespace-nowrap"
                title="Подставить автозаголовок"
              >
                Авто
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-primary-300 mb-2">Формат</label>
            <div className="flex gap-2">
              {(['pdf', 'docx'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`btn font-semibold px-5 transition-all duration-200 ${
                    format === f
                      ? 'bg-white text-primary-800 shadow-card'
                      : 'bg-white/15 text-white border border-white/30 hover:bg-white/25'
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleGenerate} disabled={generate.isPending} className="btn bg-white text-primary-800 font-semibold hover:bg-primary-50 shadow-card">
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
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="card animate-pulse flex items-center gap-3 py-3.5">
                <div className="h-9 w-9 rounded-xl bg-neutral-200 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-neutral-200 rounded w-1/2" />
                  <div className="h-2.5 bg-neutral-100 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : !reports.data || reports.data.items.length === 0 ? (
          <div className="card text-center py-12 flex flex-col items-center gap-3">
            <div className="h-14 w-14 rounded-2xl bg-primary-200 dark:bg-primary-800/40 flex items-center justify-center">
              <Download className="h-7 w-7 text-primary-600 dark:text-primary-400" />
            </div>
            <p className="text-sm text-primary-700 dark:text-primary-400 font-medium">
              Пока нет сгенерированных отчётов
            </p>
            <p className="text-xs text-primary-500 dark:text-primary-500">
              Нажмите «Сгенерировать и скачать» выше
            </p>
          </div>
        ) : (
          <div className="card divide-y divide-primary-200/60 dark:divide-primary-700/40">
            {reports.data.items.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-primary-200 dark:bg-primary-800/50 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-4.5 w-4.5 text-primary-700 dark:text-primary-300" />
                  </div>
                  <div>
                    <div className="font-semibold text-primary-900 dark:text-primary-100 text-sm">
                      {r.title}
                    </div>
                    <div className="text-xs text-primary-500 dark:text-primary-500 mt-0.5">
                      {r.format.toUpperCase()} · {new Date(r.createdAt).toLocaleString('ru-RU')}
                    </div>
                  </div>
                </div>
                <button onClick={() => downloadReport(r.id)} className="btn-outline px-3 py-1.5 text-xs gap-1.5">
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
