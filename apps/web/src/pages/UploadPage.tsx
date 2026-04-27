import { Loader2, Upload as UploadIcon, FileText, Type } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useCreateManualReview, useUploadCsv } from '../lib/queries';

type Tab = 'csv' | 'manual';

export function UploadPage() {
  const [tab, setTab] = useState<Tab>('csv');
  const [text, setText] = useState('');
  const [rating, setRating] = useState<number | ''>('');
  const [productName, setProductName] = useState('');
  const navigate = useNavigate();

  const uploadCsv = useUploadCsv();
  const createManual = useCreateManualReview();

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      const file = acceptedFiles[0];
      try {
        const result = await uploadCsv.mutateAsync({ file, productName });
        toast.success(`Загружено ${result.count} отзывов`);
        navigate('/reviews');
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: string } } };
        toast.error(e.response?.data?.error ?? 'Ошибка загрузки');
      }
    },
    [uploadCsv, navigate, productName],
  );

  const handleManualSubmit = async () => {
    if (!text.trim()) return;
    try {
      await createManual.mutateAsync({
        text: text.trim(),
        rating: rating === '' ? undefined : Number(rating),
        productName: productName.trim() || undefined,
      });
      setText('');
      setRating('');
      toast.success('Отзыв добавлен');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Ошибка');
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] },
    maxFiles: 1,
    disabled: uploadCsv.isPending,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1>Загрузка отзывов</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Загрузите CSV-файл или введите отзывы вручную
        </p>
      </div>

      <div className="card bg-primary-100 border-primary-300">
        <label className="block text-sm font-medium text-neutral-700 mb-1">
          Название товара (опционально)
        </label>
        <input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="Например: Кроссовки Nike Pegasus 40"
          className="input bg-white"
          maxLength={200}
        />
        <p className="text-xs text-neutral-500 mt-1.5">
          Указанное название создаст или дополнит товар в системе. Если оставить пустым — для CSV
          будет использовано имя файла.
        </p>
      </div>

      <div className="flex gap-1 border-b border-primary-300/50 dark:border-primary-700/40">
        {[
          { key: 'csv' as const, label: 'CSV-файл', icon: FileText },
          { key: 'manual' as const, label: 'Ручной ввод', icon: Type },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all duration-200',
              tab === key
                ? 'border-primary-600 text-primary-800 dark:text-primary-300'
                : 'border-transparent text-primary-500 dark:text-primary-500 hover:text-primary-700 dark:hover:text-primary-300',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'csv' && (
        <div
          {...getRootProps()}
          className={clsx(
            'rounded-2xl cursor-pointer text-center py-16 border-2 border-dashed transition-all duration-300',
            isDragActive
              ? 'border-primary-500 bg-primary-200/60 scale-[1.01]'
              : 'border-primary-400/60 hover:border-primary-500 hover:bg-primary-200/40',
            uploadCsv.isPending && 'opacity-60 cursor-wait',
          )}
          style={{ background: isDragActive ? 'rgba(184,216,245,0.55)' : 'rgba(211,233,248,0.45)' }}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-3">
            <div className={clsx(
              'h-16 w-16 rounded-2xl flex items-center justify-center transition-all duration-300',
              isDragActive ? 'bg-primary-500 shadow-lg' : 'bg-primary-300/70',
            )}>
              {uploadCsv.isPending ? (
                <Loader2 className="h-8 w-8 text-primary-900 animate-spin" />
              ) : (
                <UploadIcon className="h-8 w-8 text-primary-900" />
              )}
            </div>
            <p className="text-base font-semibold text-primary-900 dark:text-primary-100">
              {uploadCsv.isPending
                ? 'Загрузка...'
                : isDragActive
                  ? 'Отпустите файл здесь'
                  : 'Перетащите CSV-файл или кликните'}
            </p>
            <p className="text-xs text-primary-600 dark:text-primary-400">
              Колонки: text/review/comment, rating/score (1-5), date (опц.)
            </p>
          </div>
        </div>
      )}

      {tab === 'manual' && (
        <div className="card space-y-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input min-h-[200px] resize-y"
            placeholder="Введите текст отзыва..."
          />
          <div className="flex items-end justify-between gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">
                Рейтинг (опц.)
              </label>
              <select
                value={rating}
                onChange={(e) => setRating(e.target.value === '' ? '' : Number(e.target.value))}
                className="input w-32"
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    {r} ★
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleManualSubmit}
              disabled={!text.trim() || createManual.isPending}
              className="btn-primary"
            >
              {createManual.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Добавить отзыв
            </button>
          </div>
        </div>
      )}

      <div className="card-brand text-sm text-primary-800 dark:text-primary-300">
        <strong>Совет:</strong> после загрузки перейдите в «Отзывы» и нажмите «Запустить анализ» —
        каждый отзыв будет проанализирован LLM на тональность, аспекты и проблемы.
      </div>
    </div>
  );
}
