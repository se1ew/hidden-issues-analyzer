import { useEffect } from 'react';
import { CheckCircle2, Play, X } from 'lucide-react';

interface Props {
  count: number;
  onAnalyze: () => void;
  onLater: () => void;
}

export function AnalysisPromptModal({ count, onAnalyze, onLater }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onLater(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onLater]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onLater}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <div className="h-12 w-12 rounded-2xl bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
          </div>
          <button onClick={onLater} className="text-neutral-400 hover:text-neutral-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <h2 className="text-lg font-bold text-neutral-800 dark:text-neutral-100 mb-1">
          Загружено {count} {count === 1 ? 'отзыв' : count < 5 ? 'отзыва' : 'отзывов'}!
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
          Запустить AI-анализ прямо сейчас? Система определит тональность, аспекты и найдёт
          скрытые проблемы. Обычно занимает 1–3 минуты.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onAnalyze}
            className="btn-primary flex-1 gap-2 justify-center"
          >
            <Play className="h-4 w-4" />
            Запустить анализ сейчас
          </button>
          <button
            onClick={onLater}
            className="btn-outline flex-1 justify-center"
          >
            Посмотреть отзывы
          </button>
        </div>

        <p className="text-xs text-neutral-400 text-center mt-3">
          Анализ можно запустить позже на странице «Отзывы»
        </p>
      </div>
    </div>
  );
}
