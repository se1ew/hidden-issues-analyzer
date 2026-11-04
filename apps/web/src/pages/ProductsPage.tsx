import {
  Check,
  Edit2,
  Package,
  Plus,
  Search,
  Trash2,
  X,
  ArrowRight,
  MessageSquare,
  Star,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useCreateProduct, useDeleteProduct, useProducts, useRenameProduct } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import { ErrorState, EmptyState, LoadingState } from '../components/QueryState';
import { apiErrorMessage } from '../lib/api';
import { runStatusNames } from '../components/DataScopePanel';
import { ProductImage } from '../components/ProductImage';
import { sourceNames } from '../components/ReviewDetails';
import { Modal } from '../components/Modal';
import { ConfirmDialog, FilterBar, MetricCard, PageHeader, StatusBadge } from '../components/ui';

export function ProductsPage() {
  const products = useProducts(),
    rename = useRenameProduct(),
    remove = useDeleteProduct(),
    create = useCreateProduct();
  const [newName, setNewName] = useState(''),
    [creating, setCreating] = useState(false),
    [createError, setCreateError] = useState('');
  const { selectedProductId, setSelectedProductId } = useProductStore();
  const [editingId, setEditingId] = useState<string | null>(null),
    [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState(''),
    [source, setSource] = useState('');
  const items = (products.data?.items ?? []).filter((p) => p.id !== '__unassigned__');
  const filtered = items.filter(
    (p) =>
      p.name.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')) &&
      (!source || p.source === source),
  );
  const renameConfirm = async () => {
    if (!editingId || !editingName.trim()) return;
    try {
      await rename.mutateAsync({ id: editingId, name: editingName.trim() });
      setEditingId(null);
      toast.success('Название обновлено');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Товары"
        description="Все ваши товары и состояние анализа отзывов"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Добавить товар
          </button>
        }
      />
      <div className="grid sm:grid-cols-3 gap-4">
        <MetricCard label="Товаров" icon={Package} value={products.data ? items.length : null} />
        <MetricCard
          label="Загружено отзывов"
          icon={MessageSquare}
          value={
            products.data
              ? items.reduce((sum, p) => sum + p.reviewsCount, 0).toLocaleString('ru-RU')
              : null
          }
        />
        <MetricCard
          label="Товаров с анализом"
          icon={Star}
          tone="positive"
          value={products.data ? items.filter((p) => p.latestRun).length : null}
        />
      </div>
      <FilterBar
        active={!!(search || source)}
        onReset={() => {
          setSearch('');
          setSource('');
        }}
      >
        <label className="!flex-[3]">
          Поиск товара
          <div className="relative mt-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
            <input
              className="input !pl-9"
              type="search"
              placeholder="Введите название…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </label>
        <label>
          Источник
          <select className="input mt-1" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Все источники</option>
            {[...new Set(items.map((p) => p.source).filter((v): v is string => !!v))].map(
              (value) => (
                <option key={value} value={value}>
                  {sourceNames[value] ?? value}
                </option>
              ),
            )}
          </select>
        </label>
      </FilterBar>
      {products.isError ? (
        <ErrorState error={products.error} retry={products.refetch} />
      ) : products.isPending ? (
        <LoadingState>Загрузка товаров…</LoadingState>
      ) : !filtered.length ? (
        <EmptyState title={items.length ? 'Товары не найдены' : 'Добавьте первый товар'}>
          {items.length
            ? 'Попробуйте другое название или источник.'
            : 'Создайте товар, а затем добавьте отзывы вручную, из CSV или Wildberries.'}
        </EmptyState>
      ) : (
        <div className="grid xl:grid-cols-2 gap-4">
          {filtered.map((product) => (
            <article className="card flex flex-col gap-4" key={product.id}>
              <div className="flex gap-4 items-start">
                <ProductImage url={product.imageUrl} name={product.name} />
                <div className="min-w-0 flex-1">
                  {editingId === product.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void renameConfirm();
                      }}
                      className="space-y-2"
                    >
                      <input
                        autoFocus
                        className="input"
                        aria-label="Новое название товара"
                        value={editingName}
                        maxLength={200}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn-soft"
                          disabled={rename.isPending || !editingName.trim()}
                        >
                          <Check className="h-4 w-4" />
                          Сохранить
                        </button>
                        <button
                          className="btn-ghost"
                          type="button"
                          onClick={() => setEditingId(null)}
                          aria-label="Отменить переименование"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <h2 className="text-base leading-snug break-words">{product.name}</h2>
                      <p className="text-xs text-neutral-500 mt-2">
                        {sourceNames[product.source ?? ''] ??
                          product.source ??
                          'Источник не указан'}
                        {product.externalId ? ` · Артикул: ${product.externalId}` : ''}
                      </p>
                    </>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    className="btn-ghost !px-2"
                    title="Переименовать"
                    onClick={() => {
                      setEditingId(product.id);
                      setEditingName(product.name);
                    }}
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    className="btn-ghost !px-2 hover:!text-red-600"
                    title="Удалить товар"
                    onClick={() => setDeletingId(product.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 rounded-lg bg-neutral-50 p-3">
                <div>
                  <p className="text-lg font-semibold tabular-nums">
                    {product.reviewsCount.toLocaleString('ru-RU')}
                  </p>
                  <p className="text-[11px] text-neutral-500">Отзывов</p>
                </div>
                <div>
                  <p className="text-lg font-semibold tabular-nums">
                    {product.analyzedCount.toLocaleString('ru-RU')}
                  </p>
                  <p className="text-[11px] text-neutral-500">Обработано</p>
                </div>
                <div>
                  <p className="text-lg font-semibold tabular-nums">
                    {product.avgRating?.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) ??
                      '—'}
                  </p>
                  <p className="text-[11px] text-neutral-500">Средняя оценка</p>
                </div>
              </div>
              <div className="flex-1 text-xs text-neutral-500">
                {product.latestRun ? (
                  <>
                    <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
                      <span>
                        Последний анализ ·{' '}
                        {new Date(product.latestRun.createdAt).toLocaleDateString('ru-RU')}
                      </span>
                      <StatusBadge
                        tone={
                          product.latestRun.status === 'completed'
                            ? 'positive'
                            : product.latestRun.status === 'failed'
                              ? 'negative'
                              : 'neutral'
                        }
                      >
                        {runStatusNames[product.latestRun.status]}
                      </StatusBadge>
                    </div>
                    <p>
                      Покрытие: {product.latestRun.succeeded}/{product.latestRun.total} · Ошибки:{' '}
                      {product.latestRun.failed}
                    </p>
                  </>
                ) : (
                  <p>Запусков ещё нет · Покрытие не определено</p>
                )}
                {product.sourceUrl && (
                  <a
                    href={product.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-primary-700 break-all"
                  >
                    Открыть источник товара ↗
                  </a>
                )}
              </div>
              <footer className="flex justify-between items-center border-t border-neutral-100 pt-3">
                <StatusBadge tone={selectedProductId === product.id ? 'brand' : 'neutral'}>
                  {selectedProductId === product.id ? 'Выбранный товар' : 'Товар'}
                </StatusBadge>
                <Link
                  className="btn-outline"
                  to="/dashboard"
                  onClick={() => setSelectedProductId(product.id)}
                >
                  Открыть обзор
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </footer>
            </article>
          ))}
        </div>
      )}
      {creating && (
        <Modal
          title="Новый товар"
          className="!max-w-md"
          onClose={() => {
            if (!create.isPending) setCreating(false);
          }}
        >
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              setCreateError('');
              try {
                const product = await create.mutateAsync(newName.trim());
                setSelectedProductId(product.id);
                setNewName('');
                setCreating(false);
                toast.success('Товар создан');
              } catch (error) {
                setCreateError(apiErrorMessage(error));
              }
            }}
          >
            <label className="block text-sm">
              Название товара
              <input
                autoFocus
                className="input mt-2"
                required
                value={newName}
                maxLength={200}
                disabled={create.isPending}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Например: Беспроводные наушники"
              />
            </label>
            <p className="text-xs text-neutral-500">
              После создания добавьте отзывы в разделе «Импорт отзывов».
            </p>
            {createError && (
              <p role="alert" className="text-sm text-red-600">
                {createError}
              </p>
            )}
            <button className="btn-primary w-full" disabled={create.isPending || !newName.trim()}>
              {create.isPending ? 'Создание…' : 'Создать товар'}
            </button>
          </form>
        </Modal>
      )}
      {deletingId && (
        <ConfirmDialog
          title="Удалить товар?"
          busy={remove.isPending}
          onClose={() => setDeletingId(null)}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(deletingId);
              setDeletingId(null);
              toast.success('Товар удалён');
            } catch (error) {
              toast.error(apiErrorMessage(error));
            }
          }}
        >
          Будет удалён товар «{items.find((p) => p.id === deletingId)?.name}» и связанные исходные
          данные. Если товар используется в истории анализов, сервер сохранит его и объяснит
          ограничение.
        </ConfirmDialog>
      )}
    </div>
  );
}
