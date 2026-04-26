import { CheckCircle, Globe, Loader2 } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useStartParsing } from '../lib/queries';

export function ParsingPage() {
  const [url, setUrl] = useState('');
  const [lastResult, setLastResult] = useState<{ source: string; reviewsAdded: number } | null>(
    null,
  );
  const navigate = useNavigate();
  const startParsing = useStartParsing();

  const handleStart = async () => {
    if (!url.trim()) return;
    setLastResult(null);
    try {
      const result = await startParsing.mutateAsync(url.trim());
      setLastResult(result);
      if (result.reviewsAdded > 0) {
        toast.success(`Загружено ${result.reviewsAdded} отзывов`);
      } else {
        toast('Отзывы не найдены — возможно, у товара их нет', { icon: 'ℹ️' });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Ошибка парсинга');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary-500" />
          Парсинг отзывов
        </h1>
        <p className="text-sm text-neutral-400 mt-1">
          Загрузка отзывов с маркетплейсов по URL товара
        </p>
      </div>

      <div className="card">
        <label className="block text-sm font-medium text-neutral-600 mb-2">URL товара</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.wildberries.ru/catalog/12345678/detail.aspx"
            className="input flex-1"
            disabled={startParsing.isPending}
          />
          <button
            onClick={handleStart}
            disabled={startParsing.isPending || !url.trim()}
            className="btn-primary"
          >
            {startParsing.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Начать парсинг
          </button>
        </div>
        <p className="text-xs text-neutral-400 mt-2">
          После завершения отзывы будут добавлены в общий список и доступны для анализа
        </p>

        {lastResult && (
          <div className="mt-4 flex items-start gap-3 rounded-lg bg-primary-50 border border-primary-200 p-3">
            <CheckCircle className="h-5 w-5 text-primary-700 shrink-0 mt-0.5" />
            <div className="text-sm text-neutral-700 flex-1">
              Источник: <strong>{lastResult.source}</strong>, загружено отзывов:{' '}
              <strong>{lastResult.reviewsAdded}</strong>
              {lastResult.reviewsAdded > 0 && (
                <button
                  onClick={() => navigate('/reviews')}
                  className="ml-3 text-primary-700 hover:text-primary-800 font-medium"
                >
                  → к отзывам
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="card bg-neutral-50">
        <h3 className="text-sm font-semibold text-neutral-600 mb-2">Поддерживаемые источники</h3>
        <ul className="text-sm text-neutral-500 space-y-1 list-disc list-inside">
          <li>Wildberries (wildberries.ru) — через нативный feedbacks API</li>
        </ul>
      </div>
    </div>
  );
}
