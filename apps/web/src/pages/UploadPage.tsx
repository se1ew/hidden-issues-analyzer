import { Upload as UploadIcon, FileText, Type } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import clsx from 'clsx';

type Tab = 'csv' | 'manual';

export function UploadPage() {
  const [tab, setTab] = useState<Tab>('csv');
  const [text, setText] = useState('');

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      toast(`Файл получен: ${acceptedFiles[0].name} — загрузка пока не реализована`, { icon: 'ℹ️' });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    maxFiles: 1,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1>Загрузка отзывов</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Загрузите CSV-файл или введите отзывы вручную
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
          )}
        >
          <input {...getInputProps()} />
          <UploadIcon className="h-12 w-12 mx-auto text-primary-500 mb-3" />
          <p className="text-sm font-medium text-neutral-700">
            {isDragActive ? 'Отпустите файл здесь' : 'Перетащите CSV-файл или кликните'}
          </p>
          <p className="text-xs text-neutral-400 mt-2">
            Колонки: text, rating, date (опционально)
          </p>
        </div>
      )}

      {tab === 'manual' && (
        <div className="card">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input min-h-[200px] resize-y"
            placeholder="Введите текст отзыва..."
          />
          <div className="flex justify-end mt-4">
            <button
              onClick={() => toast('Отправка пока не реализована', { icon: 'ℹ️' })}
              disabled={!text.trim()}
              className="btn-primary"
            >
              Отправить на анализ
            </button>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3">Недавние загрузки</h2>
        <div className="card text-sm text-neutral-400 text-center py-8">
          Пока нет загрузок
        </div>
      </div>
    </div>
  );
}
