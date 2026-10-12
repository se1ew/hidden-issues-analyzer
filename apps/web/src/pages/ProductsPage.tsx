import { Check, Edit2, Package, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateProduct, useDeleteProduct, useProducts, useRenameProduct } from '../lib/queries';
import { useProductStore } from '../store/product.store';

export function ProductsPage() {
  const { data, isLoading } = useProducts();
  const renameProduct = useRenameProduct();
  const deleteProduct = useDeleteProduct();
  const createProduct = useCreateProduct();
  const [newName, setNewName] = useState('');
  const { selectedProductId, setSelectedProductId } = useProductStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const realProducts = (data?.items ?? []).filter((p) => p.id !== '__unassigned__');

  const handleRenameStart = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
  };

  const handleRenameConfirm = async () => {
    if (!editingId || !editingName.trim()) return;
    try {
      await renameProduct.mutateAsync({ id: editingId, name: editingName.trim() });
      toast.success('Название обновлено');
      setEditingId(null);
    } catch {
      toast.error('Не удалось переименовать');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProduct.mutateAsync(id);
      toast.success('Товар удалён');
      if (selectedProductId === id) setSelectedProductId(null);
      setDeletingId(null);
    } catch {
      toast.error('Не удалось удалить');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2">
          <Package className="h-6 w-6 text-primary-500" />
          Товары
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          Создание товаров и управление отзывами
        </p>
      </div>

      <form className="card flex flex-wrap gap-3" onSubmit={async (event) => {
        event.preventDefault();
        if (!newName.trim()) return;
        try {
          const product = await createProduct.mutateAsync(newName.trim());
          setSelectedProductId(product.id); setNewName('');
          toast.success('Товар создан');
        } catch { toast.error('Не удалось создать товар'); }
      }}>
        <label className="flex-1 min-w-48">Название нового товара
          <input className="input mt-1" value={newName} maxLength={200}
            onChange={(event) => setNewName(event.target.value)} placeholder="Например: Беспроводные наушники" />
        </label>
        <button className="btn-primary self-end" disabled={createProduct.isPending || !newName.trim()}>Создать товар</button>
      </form>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-5 bg-neutral-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-neutral-100 rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : realProducts.length === 0 ? (
        <div className="card text-center py-12">
          <Package className="h-10 w-10 mx-auto text-neutral-300 mb-3" />
          <p className="text-sm text-neutral-400">
            Создайте товар здесь или при загрузке отзывов.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {realProducts.map((product) => (
            <div key={product.id} className="card flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                <Package className="h-5 w-5 text-primary-700" />
              </div>

              <div className="flex-1 min-w-0">
                {editingId === product.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameConfirm();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="input py-1 text-sm"
                    maxLength={200}
                  />
                ) : (
                  <>
                    <div className="font-semibold text-neutral-800 dark:text-neutral-100 truncate">
                      {product.name}
                    </div>
                    <div className="text-xs text-neutral-400 mt-0.5">
                      {product.reviewsCount} отзывов · {product.analyzedCount} проанализировано
                      {product.avgRating != null && ` · ★ ${product.avgRating.toFixed(2)}`}
                    </div>
                    {(product.externalId || product.sourceUrl) && <div className="text-xs text-neutral-400 mt-1 break-all">
                      {product.externalId && `Артикул: ${product.externalId}`}
                      {product.sourceUrl && ` · ${product.sourceUrl}`}
                    </div>}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {editingId === product.id ? (
                  <>
                    <button
                      onClick={handleRenameConfirm}
                      disabled={renameProduct.isPending}
                      className="btn-soft px-3 py-1.5 text-xs"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Сохранить
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="btn-outline px-3 py-1.5 text-xs"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : deletingId === product.id ? (
                  <>
                    <span className="text-xs text-neutral-500">Удалить?</span>
                    <button
                      onClick={() => handleDelete(product.id)}
                      disabled={deleteProduct.isPending}
                      className="btn px-3 py-1.5 text-xs bg-red-600 text-white hover:bg-red-700"
                    >
                      Да
                    </button>
                    <button
                      onClick={() => setDeletingId(null)}
                      className="btn-outline px-3 py-1.5 text-xs"
                    >
                      Нет
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleRenameStart(product.id, product.name)}
                      className="btn-outline px-3 py-1.5 text-xs"
                      title="Переименовать"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingId(product.id)}
                      className="btn-outline px-3 py-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50"
                      title="Удалить"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
