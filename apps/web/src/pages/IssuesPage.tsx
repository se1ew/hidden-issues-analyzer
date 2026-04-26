import { AlertTriangle, TrendingUp } from 'lucide-react';

export function IssuesPage() {
  // Заглушка
  const issues: Array<{
    id: string;
    title: string;
    description: string;
    size: number;
    severity: number;
    visibility: number;
    hiddenScore: number;
    keywords: string[];
  }> = [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-primary-500" />
            Скрытые проблемы
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            Кластеры повторяющихся жалоб, ранжированные по скрытости и серьёзности
          </p>
        </div>
        <button className="btn-primary">Пересчитать</button>
      </div>

      <div className="card bg-primary-50 border-primary-200">
        <h3 className="mb-2 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary-700" />
          Что такое «скрытая» проблема?
        </h3>
        <p className="text-sm text-neutral-600">
          Это проблема, которая встречается редко (низкая видимость), но почти всегда сопровождается
          сильным негативом (высокая серьёзность). Такие проблемы легко пропустить при ручном
          просмотре, но они критичны для качества товара.
        </p>
        <p className="text-sm text-neutral-500 mt-2">
          <strong>hidden_score = severity × (1 − visibility)</strong>
        </p>
      </div>

      {issues.length === 0 ? (
        <div className="card text-center py-12">
          <AlertTriangle className="h-10 w-10 mx-auto text-neutral-300 mb-3" />
          <p className="text-sm text-neutral-400">
            Кластеры пока не сформированы. Запустите анализ отзывов и нажмите «Пересчитать».
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => (
            <div key={issue.id} className="card hover:border-primary-300 transition cursor-pointer">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <h3 className="text-neutral-700">{issue.title}</h3>
                  <p className="text-sm text-neutral-500 mt-1">{issue.description}</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {issue.keywords.map((kw) => (
                      <span key={kw} className="badge bg-neutral-100 text-neutral-600">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-semibold text-primary-700">
                    {(issue.hiddenScore * 100).toFixed(0)}
                  </div>
                  <div className="text-xs text-neutral-400">hidden score</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-neutral-100 text-xs">
                <Stat label="Отзывов" value={issue.size.toString()} />
                <Stat label="Серьёзность" value={`${(issue.severity * 100).toFixed(0)}%`} />
                <Stat label="Видимость" value={`${(issue.visibility * 100).toFixed(1)}%`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-neutral-400">{label}</div>
      <div className="text-neutral-700 font-medium">{value}</div>
    </div>
  );
}
