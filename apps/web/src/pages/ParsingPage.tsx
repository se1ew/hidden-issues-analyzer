import { Globe, Loader2 } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

export function ParsingPage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast('Парсинг пока не реализован', { icon: 'ℹ️' });
    }, 600);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary-500" />
          Парсинг отзывов
        </h1>
        <p className="text-sm text-neutral-400 mt-1">
          Загрузка отзывов с маркетплейсов по URL товара (Wildberries, Ozon)
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
          />
          <button onClick={handleStart} disabled={loading || !url.trim()} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Начать парсинг
          </button>
        </div>
        <p className="text-xs text-neutral-400 mt-2">
          После завершения отзывы будут добавлены в общий список и доступны для анализа
        </p>
      </div>

      <div className="card bg-neutral-50">
        <h3 className="text-sm font-semibold text-neutral-600 mb-2">Поддерживаемые источники</h3>
        <ul className="text-sm text-neutral-500 space-y-1 list-disc list-inside">
          <li>Wildberries (wildberries.ru)</li>
          <li>Ozon (ozon.ru)</li>
        </ul>
      </div>
    </div>
  );
}
