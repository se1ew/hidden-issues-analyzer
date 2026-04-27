import { Play, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStats, useRunAnalysis } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import toast from 'react-hot-toast';

export function AnalysisBanner() {
  const navigate = useNavigate();
  const { selectedProductId } = useProductStore();
  const stats = useStats(selectedProductId);
  const runAnalysis = useRunAnalysis();

  const s = stats.data;
  const unanalyzed = s ? s.total - s.analyzed : 0;

  if (stats.isLoading || !s || unanalyzed === 0) return null;

  const handleRun = async () => {
    try {
      await runAnalysis.mutateAsync(undefined);
      toast.success('Анализ запущен');
      navigate('/reviews');
    } catch {
      toast.error('Не удалось запустить анализ');
    }
  };

  const word = unanalyzed === 1 ? 'отзыв' : unanalyzed < 5 ? 'отзыва' : 'отзывов';

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-amber-200 dark:bg-amber-800 flex items-center justify-center shrink-0">
          <Zap className="h-4 w-4 text-amber-700 dark:text-amber-300" />
        </div>
        <div>
          <span className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
            {unanalyzed} {word} ещё не проанализированы
          </span>
          <span className="hidden sm:inline text-amber-700 dark:text-amber-400 text-xs ml-2">
            — результаты могут быть неполными
          </span>
        </div>
      </div>
      <button
        onClick={handleRun}
        disabled={runAnalysis.isPending}
        className="btn-primary bg-amber-500 hover:bg-amber-600 border-amber-500 text-sm shrink-0 gap-2"
      >
        <Play className="h-3.5 w-3.5" />
        Запустить анализ
      </button>
    </div>
  );
}
