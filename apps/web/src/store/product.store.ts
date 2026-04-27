import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProductState {
  selectedProductId: string | null; // null = «все товары»
  setSelectedProductId: (id: string | null) => void;
}

export const useProductStore = create<ProductState>()(
  persist(
    (set) => ({
      selectedProductId: null,
      setSelectedProductId: (id) => set({ selectedProductId: id }),
    }),
    { name: 'hia.selectedProduct' },
  ),
);
