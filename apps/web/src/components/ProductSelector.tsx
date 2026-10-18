import { Package } from 'lucide-react';
import { useProducts } from '../lib/queries';
import { useProductStore } from '../store/product.store';

export function ProductSelector({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useProducts();
  const { selectedProductId, setSelectedProductId, selectedRunId, setDataScope } = useProductStore();

  const items = data?.items ?? [];
  const totalReviews = items.reduce((s, p) => s + p.reviewsCount, 0);
  const selected = items.find((p) => p.id === selectedProductId) ?? null;

  return (
    <div
      className={
        compact
          ? 'flex items-center gap-2'
          : 'flex flex-wrap items-center gap-3 rounded-xl bg-primary-100 border border-primary-300 px-4 py-3'
      }
    >
      {!compact && <Package className="h-5 w-5 text-primary-700" />}
      <label htmlFor={compact ? 'scope-product' : 'page-product'} className="text-sm font-medium text-neutral-700 whitespace-nowrap">
        Товар:
      </label>
      <select
        id={compact ? 'scope-product' : 'page-product'}
        value={selectedProductId ?? ''}
        onChange={(e) => setSelectedProductId(e.target.value || null)}
        disabled={isLoading || items.length === 0}
        className="input flex-1 min-w-0 max-w-full"
      >
        <option value="">Все товары ({totalReviews})</option>
        {items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.reviewsCount})
          </option>
        ))}
      </select>
      {selected && !compact && (
        <span className="text-xs text-neutral-500 hidden md:inline">
          анализировано: {selected.analyzedCount}/{selected.reviewsCount}
          {selected.avgRating != null && ` · ★ ${selected.avgRating.toFixed(2)}`}
        </span>
      )}
      {selectedRunId && !compact && <span className="text-xs text-neutral-600 dark:text-neutral-300">
        Выбран запуск: {selectedRunId} · <button className="underline" onClick={() => setDataScope({ runId: null, from: null, to: null })}>Сбросить область запуска</button>
      </span>}
    </div>
  );
}
