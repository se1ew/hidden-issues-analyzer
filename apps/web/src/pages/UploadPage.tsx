import { CheckCircle, Clock, Globe, Loader2, FileText, Type } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useCreateManualReview, useParsingHistory, useProducts, useRunAnalysis, useStartParsing } from '../lib/queries';
import { useProductStore } from '../store/product.store';
import { CsvImportWizard } from '../components/CsvImportWizard';
import { LlmStatus } from '../components/LlmStatus';
import { ErrorState } from '../components/QueryState';

type Tab = 'csv' | 'manual' | 'parsing';

export function UploadPage() {
  const [tab, setTab] = useState<Tab>('csv');
  const [text, setText] = useState('');
  const [rating, setRating] = useState<number | ''>('');
  const [productName, setProductName] = useState('');
  const [productChoice, setProductChoice] = useState(useProductStore.getState().selectedProductId ?? '');
  const productId = productChoice && productChoice !== '__new__' ? productChoice : undefined;
  const newProductName = productChoice === '__new__' ? productName.trim() : undefined;
  const productReady = Boolean(productId || newProductName);
  const navigate = useNavigate();

  const createManual = useCreateManualReview();
  const runAnalysis = useRunAnalysis();
  const startParsing = useStartParsing();
  const parsingHistory = useParsingHistory();
  const products = useProducts();
  const [uploadedCount, setUploadedCount] = useState<number | null>(null);
  const [parseUrl, setParseUrl] = useState('');
  const [parseResult, setParseResult] = useState<{ source: string; reviewsAdded: number } | null>(null);
  const handleManualSubmit = async () => {
    if (!text.trim() || !productReady) return;
    try {
      const result = await createManual.mutateAsync({
        text,
        rating: rating === '' ? undefined : Number(rating),
        productName: newProductName,
        productId,
      });
      useProductStore.getState().setSelectedProductId(result.productId);
      setProductChoice(result.productId);
      setText('');
      setRating('');
      toast.success('Отзыв добавлен');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Ошибка');
    }
  };

  const handleAnalyzeNow = async () => {
    setUploadedCount(null);
    try {
      await runAnalysis.mutateAsync(undefined);
      toast.success('Анализ запущен');
    } catch {
      toast.error('Не удалось запустить анализ');
    }
    navigate('/reviews');
  };

  const handleAnalyzeLater = () => {
    setUploadedCount(null);
    navigate('/reviews');
  };

  return (
    <div className="space-y-6">
      <LlmStatus />
      {products.isError && <ErrorState error={products.error} retry={products.refetch} />}
      {parsingHistory.isError && <ErrorState error={parsingHistory.error} retry={parsingHistory.refetch} />}
      {uploadedCount !== null && (
        <div className="card space-y-3">
          <p>Добавлено отзывов: {uploadedCount}. Можно запустить анализ выбранного товара.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={runAnalysis.isPending} onClick={handleAnalyzeNow}>Запустить анализ</button>
            <button className="btn-secondary" onClick={handleAnalyzeLater}>Перейти к отзывам</button>
          </div>
        </div>
      )}
      <div>
        <h1>Загрузка отзывов</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Выберите источник: CSV-файл, ручной ввод или Wildberries
        </p>
      </div>

      {tab !== 'parsing' && <div className="card bg-primary-100 border-primary-300">
        <label htmlFor="import-product" className="block text-sm font-medium text-neutral-700 mb-1">Товар *</label>
        <select id="import-product" className="input" value={productChoice} onChange={(event) => setProductChoice(event.target.value)}>
          <option value="">Выберите товар</option><option value="__new__">Создать новый товар</option>
          {(products.data?.items ?? []).filter((product) => product.id !== '__unassigned__').map((product) =>
            <option key={product.id} value={product.id}>{product.name}{product.sourceUrl ? ' · ' + product.sourceUrl : ''}</option>)}
        </select>
        {productChoice === '__new__' && <label className="block text-sm mt-3">Название нового товара
          <input type="text" value={productName} onChange={(event) => setProductName(event.target.value)}
            placeholder="Например: Кроссовки Nike Pegasus 40" className="input" maxLength={200} />
        </label>}
        <p className="text-xs text-neutral-500 mt-1.5">Отзывы добавляются в выбранный товар. Новый товар создаётся при успешном импорте.</p>
      </div>}

      <div className="flex gap-1 border-b border-primary-300/50 dark:border-primary-700/40">
        {[
          { key: 'csv' as const, label: 'CSV-файл', icon: FileText },
          { key: 'manual' as const, label: 'Ручной ввод', icon: Type },
          { key: 'parsing' as const, label: 'Wildberries', icon: Globe },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all duration-200',
              tab === key
                ? 'border-primary-600 text-primary-800 dark:text-primary-300'
                : 'border-transparent text-primary-500 dark:text-primary-500 hover:text-primary-700 dark:hover:text-primary-300',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'csv' && <CsvImportWizard productId={productId} productName={newProductName} onImported={(result) => {
        useProductStore.getState().setSelectedProductId(result.productId);
        setProductChoice(result.productId);
        if (result.count > 0) setUploadedCount(result.count);
      }} />}

      {tab === 'parsing' && (
        <div className="space-y-4">
          <div className="card">
            <label className="block text-sm font-medium text-neutral-600 mb-2">URL товара</label>
            <div className="flex gap-2">
              <input
                type="url"
                aria-label="Ссылка Wildberries" value={parseUrl}
                onChange={(e) => setParseUrl(e.target.value)}
                placeholder="https://www.wildberries.ru/catalog/12345678/detail.aspx"
                className="input flex-1"
                disabled={startParsing.isPending}
              />
              <button
                onClick={async () => {
                  if (!parseUrl.trim()) return;
                  setParseResult(null);
                  try {
                    const result = await startParsing.mutateAsync(parseUrl.trim());
                    setParseResult(result);
                    if (result.reviewsAdded > 0) toast.success(`Загружено ${result.reviewsAdded} отзывов`);
                    else toast('Отзывы не найдены', { icon: 'ℹ️' });
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { error?: string } } };
                    toast.error(e.response?.data?.error ?? 'Ошибка парсинга');
                  }
                }}
                disabled={startParsing.isPending || !parseUrl.trim()}
                className="btn-primary"
              >
                {startParsing.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Начать парсинг
              </button>
            </div>
            <p className="text-xs text-neutral-400 mt-2">Поддерживается: Wildberries (wildberries.ru)</p>
            {parseResult && (
              <div className="mt-4 flex items-start gap-3 rounded-lg bg-primary-50 border border-primary-200 p-3">
                <CheckCircle className="h-5 w-5 text-primary-700 shrink-0 mt-0.5" />
                <div className="text-sm text-neutral-700 flex-1">
                  Источник: <strong>{parseResult.source}</strong>, загружено: <strong>{parseResult.reviewsAdded}</strong>
                  {parseResult.reviewsAdded > 0 && (
                    <button onClick={() => navigate('/reviews')} className="ml-3 text-primary-700 hover:text-primary-800 font-medium">
                      → к отзывам
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-600">
              <Clock className="h-4 w-4" /> История парсинга
            </h3>
            {parsingHistory.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="card animate-pulse">
                    <div className="h-4 bg-neutral-200 rounded w-1/2 mb-1.5" />
                    <div className="h-3 bg-neutral-100 rounded w-1/4" />
                  </div>
                ))}
              </div>
            ) : !parsingHistory.data || parsingHistory.data.items.length === 0 ? (
              <div className="card text-center py-6">
                <p className="text-sm text-neutral-400">История пуста — запустите парсинг выше</p>
              </div>
            ) : (
              <div className="card divide-y divide-neutral-100">
                {parsingHistory.data.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div>
                      <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{item.filename ?? 'URL'}</div>
                      <div className="text-xs text-neutral-400 mt-0.5">{new Date(item.createdAt).toLocaleString('ru-RU')}</div>
                    </div>
                    <span className="text-sm font-semibold text-primary-700">+{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'manual' && (
        <div className="card space-y-4">
          <textarea aria-label="Текст отзыва"
            maxLength={10_000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input min-h-[200px] resize-y"
            placeholder="Введите текст отзыва..."
          />
          <div className="flex items-end justify-between gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">
                Рейтинг (опц.)
              </label>
              <select
                aria-label="Оценка отзыва" value={rating}
                onChange={(e) => setRating(e.target.value === '' ? '' : Number(e.target.value))}
                className="input w-32"
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    {r} ★
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleManualSubmit}
              disabled={!text.trim() || !productReady || createManual.isPending}
              className="btn-primary"
            >
              {createManual.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Добавить отзыв
            </button>
          </div>
        </div>
      )}

      <div className="card-brand text-sm text-primary-800 dark:text-primary-300">
        <strong>Совет:</strong> после загрузки перейдите в «Отзывы» и нажмите «Запустить анализ» —
        каждый отзыв будет проанализирован LLM на тональность, аспекты и проблемы.
      </div>
    </div>
  );
}
