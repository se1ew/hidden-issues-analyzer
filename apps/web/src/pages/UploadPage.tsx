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

      <div className="flex gap-2 border-b border-neutral-100">
        {[
          { key: 'csv' as const, label: 'CSV-файл', icon: FileText },
          { key: 'manual' as const, label: 'Ручной ввод', icon: Type },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition',
              tab === key
                ? 'border-primary-500 text-neutral-700'
                : 'border-transparent text-neutral-400 hover:text-neutral-600',
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
            'card cursor-pointer text-center py-16 border-2 border-dashed transition',
            isDragActive
              ? 'border-primary-400 bg-primary-50'
              : 'border-neutral-200 hover:border-primary-300 hover:bg-neutral-50',
            uploadCsv.isPending && 'opacity-60 cursor-wait',
          )}
        >
          <input {...getInputProps()} />
          {uploadCsv.isPending ? (
            <Loader2 className="h-12 w-12 mx-auto text-primary-500 mb-3 animate-spin" />
          ) : (
            <UploadIcon className="h-12 w-12 mx-auto text-primary-500 mb-3" />
          )}
          <p className="text-sm font-medium text-neutral-700">
            {uploadCsv.isPending
              ? 'Загрузка...'
              : isDragActive
                ? 'Отпустите файл здесь'
                : 'Перетащите CSV-файл или кликните'}
          </p>
          <p className="text-xs text-neutral-400 mt-2">
            Колонки: text/review/comment, rating/score (1-5), date (опц.)
          </p>
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

      <div className="card bg-primary-50 border-primary-200 text-sm text-neutral-600">
        <strong>Совет:</strong> после загрузки перейдите в «Отзывы» и нажмите «Запустить анализ» —
        каждый отзыв будет проанализирован LLM на тональность, аспекты и проблемы.
      </div>
    </div>
  );
}
