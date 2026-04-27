import { CheckCircle, Clock, Globe, Loader2, Upload as UploadIcon, FileText, Type } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useCreateManualReview, useParsingHistory, useProducts, useRunAnalysis, useStartParsing, useUploadCsv } from '../lib/queries';
import { AnalysisPromptModal } from '../components/AnalysisPromptModal';

type Tab = 'csv' | 'manual' | 'parsing';

export function UploadPage() {
  const [tab, setTab] = useState<Tab>('csv');
  const [text, setText] = useState('');
  const [rating, setRating] = useState<number | ''>('');
  const [productName, setProductName] = useState('');
  const navigate = useNavigate();

  const uploadCsv = useUploadCsv();
  const createManual = useCreateManualReview();
  const runAnalysis = useRunAnalysis();
  const startParsing = useStartParsing();
  const parsingHistory = useParsingHistory();
  const products = useProducts();
  const [uploadedCount, setUploadedCount] = useState<number | null>(null);
  const [parseUrl, setParseUrl] = useState('');
  const [parseResult, setParseResult] = useState<{ source: string; reviewsAdded: number } | null>(null);
  const productNames = (products.data?.items ?? [])
    .filter((p) => p.id !== '__unassigned__')
    .map((p) => p.name);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      const file = acceptedFiles[0];
      try {
        const result = await uploadCsv.mutateAsync({ file, productName });
        toast.success(`Загружено ${result.count} отзывов`);
        setUploadedCount(result.count);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: string } } };
        toast.error(e.response?.data?.error ?? 'Ошибка загрузки');
      }
    },
    [uploadCsv, productName],
  );

  const handleManualSubmit = async () => {
    if (!text.trim()) return;
    try {
      await createManual.mutateAsync({
        text: text.trim(),
        rating: rating === '' ? undefined : Number(rating),
        productName: productName.trim() || undefined,
      });
      setText('');
      setRating('');
      toast.success('Отзыв добавлен');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Ошибка');
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] },
    maxFiles: 1,
    disabled: uploadCsv.isPending,
  });

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
      {uploadedCount !== null && (
        <AnalysisPromptModal
          count={uploadedCount}
          onAnalyze={handleAnalyzeNow}
          onLater={handleAnalyzeLater}
        />
      )}
      <div>
        <h1>Загрузка отзывов</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Загрузите CSV-файл или введите отзывы вручную
        </p>
      </div>

      <div className="card bg-primary-100 border-primary-300">
        <label className="block text-sm font-medium text-neutral-700 mb-1">
          Название товара (опционально)
        </label>
        <input
          type="text"
          list="product-names-list"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="Например: Кроссовки Nike Pegasus 40"
          className="input bg-white"
          maxLength={200}
        />
        <datalist id="product-names-list">
          {productNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <p className="text-xs text-neutral-500 mt-1.5">
          Указанное название создаст или дополнит товар в системе. Если оставить пустым — для CSV
          будет использовано имя файла.
        </p>
      </div>

      <div className="flex gap-1 border-b border-primary-300/50 dark:border-primary-700/40">
        {[
          { key: 'csv' as const, label: 'CSV-файл', icon: FileText },
          { key: 'manual' as const, label: 'Ручной ввод', icon: Type },
          { key: 'parsing' as const, label: 'Парсинг URL', icon: Globe },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
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

      {tab === 'csv' && (
        <div
          {...getRootProps()}
          className={clsx(
            'rounded-2xl cursor-pointer text-center py-16 border-2 border-dashed transition-all duration-300',
            isDragActive
              ? 'border-primary-500 bg-primary-200/60 scale-[1.01]'
              : 'border-primary-400/60 hover:border-primary-500 hover:bg-primary-200/40',
            uploadCsv.isPending && 'opacity-60 cursor-wait',
          )}
          style={{ background: isDragActive ? 'rgba(184,216,245,0.55)' : 'rgba(211,233,248,0.45)' }}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-3">
            <div className={clsx(
              'h-16 w-16 rounded-2xl flex items-center justify-center transition-all duration-300',
              isDragActive ? 'bg-primary-500 shadow-lg' : 'bg-primary-300/70',
            )}>
              {uploadCsv.isPending ? (
                <Loader2 className="h-8 w-8 text-primary-900 animate-spin" />
              ) : (
                <UploadIcon className="h-8 w-8 text-primary-900" />
              )}
            </div>
            <p className="text-base font-semibold text-primary-900 dark:text-primary-100">
              {uploadCsv.isPending
                ? 'Загрузка...'
                : isDragActive
                  ? 'Отпустите файл здесь'
                  : 'Перетащите CSV-файл или кликните'}
            </p>
            <p className="text-xs text-primary-600 dark:text-primary-400">
              Колонки: text/review/comment, rating/score (1-5), date (опц.)
            </p>
          </div>
        </div>
      )}

      {tab === 'parsing' && (
        <div className="space-y-4">
          <div className="card">
            <label className="block text-sm font-medium text-neutral-600 mb-2">URL товара</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={parseUrl}
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
          <textarea
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
                value={rating}
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
              disabled={!text.trim() || createManual.isPending}
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
