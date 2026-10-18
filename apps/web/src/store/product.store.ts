import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProductState {
  selectedProductId: string | null; // null = «все товары»
  selectedRunId: string | null;
  from: string | null;
  to: string | null;
  setDataScope: (scope: { runId?: string | null; from?: string | null; to?: string | null }) => void;
  setSelectedProductId: (id: string | null) => void;
}

export const useProductStore = create<ProductState>()(
  persist(
    (set) => ({
      selectedProductId: null,
      selectedRunId: null, from: null, to: null,
      setSelectedProductId: (id) => set({ selectedProductId: id, selectedRunId: null, from: null, to: null }),
      setDataScope: (scope) => set((state) => ({ selectedRunId: scope.runId === undefined ? state.selectedRunId : scope.runId,
        from: scope.from === undefined ? state.from : scope.from, to: scope.to === undefined ? state.to : scope.to })),
    }),
    { name: 'hia.selectedProduct', partialize: (state) => ({ selectedProductId: state.selectedProductId }) },
  ),
);
