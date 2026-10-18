import { useProductStore } from '../store/product.store';
import { useAuthStore } from '../store/auth.store';

export const useOwnerId = () => useAuthStore(state => state.user?.id ?? null);
export function useDataScope(productId?: string | null) {
  const selected = useProductStore();
  const same = !!productId && selected.selectedProductId === productId;
  return { ...(productId ? { productId } : {}),
    ...(same && selected.selectedRunId ? { runId: selected.selectedRunId } : {}),
    ...(same && selected.from && selected.to ? { from: selected.from, to: selected.to } : {}) };
}
