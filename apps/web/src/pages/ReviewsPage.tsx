import { Filter, Play } from 'lucide-react';

export function ReviewsPage() {
  // Заглушка
  const reviews: Array<{
    id: string;
    text: string;
    rating: number | null;
    sentiment: string | null;
    issues: string[];
    createdAt: string;
  }> = [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1>Отзывы</h1>
          <p className="text-sm text-neutral-400 mt-1">Все загруженные отзывы с результатами анализа</p>
        </div>
        <button className="btn-primary">
          <Play className="h-4 w-4" />
          Запустить анализ
        </button>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-neutral-400" />
          <span className="text-sm font-medium text-neutral-600">Фильтры</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select className="input">
            <option value="">Все тональности</option>
            <option value="positive">Позитивные</option>
            <option value="negative">Негативные</option>
            <option value="neutral">Нейтральные</option>
          </select>
          <select className="input">
            <option value="">Все отзывы</option>
            <option value="with-issues">С проблемами</option>
            <option value="without-issues">Без проблем</option>
          </select>
          <select className="input">
            <option value="">Любой рейтинг</option>
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                {r} звёзд
              </option>
            ))}
          </select>
          <button className="btn-outline">Применить</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
              <th className="pb-3 pr-3">ID</th>
              <th className="pb-3 pr-3">Текст</th>
              <th className="pb-3 pr-3">Рейтинг</th>
              <th className="pb-3 pr-3">Тональность</th>
              <th className="pb-3 pr-3">Проблемы</th>
              <th className="pb-3 pr-3">Дата</th>
              <th className="pb-3"></th>
            </tr>
          </thead>
          <tbody>
            {reviews.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-neutral-400">
                  Нет отзывов. Загрузите данные на странице «Загрузка».
                </td>
              </tr>
            ) : (
              reviews.map((r) => (
                <tr key={r.id} className="border-b border-neutral-50 hover:bg-neutral-50">
                  <td className="py-3 pr-3 text-xs text-neutral-400">{r.id.slice(0, 6)}</td>
                  <td className="py-3 pr-3 max-w-md truncate">{r.text}</td>
                  <td className="py-3 pr-3">{r.rating ?? '—'}</td>
                  <td className="py-3 pr-3">{r.sentiment ?? '—'}</td>
                  <td className="py-3 pr-3">{r.issues.length}</td>
                  <td className="py-3 pr-3">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="py-3">
                    <button className="text-primary-600 hover:text-primary-700 text-xs font-medium">
                      Детали
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
