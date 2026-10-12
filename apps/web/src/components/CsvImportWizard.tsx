import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { Loader2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { usePreviewCsv, useUploadCsv, type CsvField, type CsvMapping, type CsvPreview, type CsvImportResult } from '../lib/queries';

const fields: Array<{ key: CsvField; label: string }> = [
  { key: 'text', label: 'Текст отзыва *' }, { key: 'rating', label: 'Оценка' },
  { key: 'date', label: 'Дата' }, { key: 'externalId', label: 'ID отзыва' },
  { key: 'authorExternalId', label: 'ID автора' },
];
const errorMessage = (error: unknown) => (error as { response?: { data?: { error?: string } } })
  .response?.data?.error ?? 'Не удалось обработать CSV';

export function CsvImportWizard({ productId, productName, onImported }: {
  productId?: string; productName?: string; onImported: (result: CsvImportResult) => void;
}) {
  const inspect = usePreviewCsv();
  const upload = useUploadCsv();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [delimiter, setDelimiter] = useState('');
  const [verified, setVerified] = useState(false);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  const busy = inspect.isPending || upload.isPending;

  const checkFile = async (selected: File, options: { delimiter?: string; mapping?: CsvMapping } = {}) => {
    setVerified(false);
    try {
      const data = await inspect.mutateAsync({ file: selected, ...options });
      setPreview(data);
      setMapping(data.mapping);
      setDelimiter(data.delimiter);
      setVerified(true);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] },
    maxFiles: 1, maxSize: 25 * 1024 * 1024, disabled: busy,
    onDrop: async (files, rejected) => {
      if (rejected.length) { toast.error('Выберите один CSV-файл размером до 25 МиБ'); return; }
      if (!files[0]) return;
      setFile(files[0]); setPreview(null); setResult(null); setMapping({}); setDelimiter('');
      await checkFile(files[0]);
    },
  });

  const importFile = async () => {
    if (!file || !preview || !verified) return;
    try {
      const imported = await upload.mutateAsync({ file, productId, productName, delimiter, mapping });
      setResult(imported);
      setVerified(false);
      if (imported.errorCount) toast(`Добавлено ${imported.count}; ошибки в ${imported.errorCount} записях`, { icon: '⚠️' });
      else toast.success(`Добавлено ${imported.count}, дубли: ${imported.skippedCount}`);
      onImported(imported);
    } catch (error) { toast.error(errorMessage(error)); }
  };

  const downloadErrors = async () => {
    if (!result) return;
    setDownloading(true);
    try {
      const { data } = await api.get<Blob>(`/api/reviews/imports/${result.batchId}/errors`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url; link.download = 'import-errors.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast.error('Не удалось скачать ошибки'); }
    finally { setDownloading(false); }
  };

  return <div className="space-y-4">
    <div {...getRootProps()} className={`card cursor-pointer border-2 border-dashed text-center py-8 ${isDragActive ? 'border-primary-500' : ''}`}>
      <input {...getInputProps()} />
      {busy ? <Loader2 className="h-8 w-8 mx-auto animate-spin" /> : <Upload className="h-8 w-8 mx-auto text-primary-600" />}
      <p className="font-semibold mt-2">{file?.name ?? 'Перетащите CSV-файл или выберите его'}</p>
      <p className="text-xs text-neutral-500 mt-1">UTF-8 / BOM; до 25 МиБ и 10 000 записей. Сначала предпросмотр, затем импорт.</p>
    </div>

    {file && <div className="card space-y-4">
      <label className="block text-sm">Разделитель
        <select className="input mt-1" value={delimiter} disabled={busy} onChange={(event) => {
          setDelimiter(event.target.value); setVerified(false); setPreview(null); setMapping({});
        }}>
          <option value="">Определить автоматически</option><option value=",">Запятая</option>
          <option value=";">Точка с запятой</option><option value={'\t'}>Табуляция</option>
        </select>
      </label>
      {preview && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(({ key, label }) => <label key={key} className="text-sm">{label}
            <select className="input mt-1" value={mapping[key] ?? ''} disabled={busy} onChange={(event) => {
              setMapping({ ...mapping, [key]: event.target.value }); setVerified(false);
            }}>
              <option value="">{key === 'text' ? 'Выберите колонку' : 'Не использовать'}</option>
              {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
            </select>
          </label>)}
        </div>
        <p className="text-xs text-neutral-500">Оценки: целые 1–5. Даты: YYYY-MM-DD или ISO-время с часовым поясом. Пустые оценка и дата допустимы.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Запись</th>
            {preview.headers.map((header) => <th className="p-2 text-left" key={header}>{header}</th>)}
          </tr></thead><tbody>{preview.sample.map((row) => <tr key={row.rowNumber}>
            <td className="p-2">{row.rowNumber}</td>{row.values.map((value, index) =>
              <td className="p-2 whitespace-pre-wrap min-w-32 max-w-80 break-words" key={index}>{value.slice(0, 300)}{value.length > 300 ? '…' : ''}</td>)}
          </tr>)}</tbody></table>
        </div>
      </>}
      <button className="btn-secondary" disabled={busy} onClick={() => {
        void checkFile(file, { delimiter: delimiter || undefined, mapping: preview ? mapping : undefined });
      }}>Проверить строки</button>
      {verified && preview && <div role="status" className="space-y-2">
        <p>Всего: {preview.totalCount}. Корректных: {preview.validCount}. С ошибками: {preview.errorCount}.</p>
        {preview.errors.length > 0 && <div className="max-h-48 overflow-auto text-sm text-amber-700 dark:text-amber-300">
          {preview.errors.map((error, index) => <p key={index}>Запись {error.rowNumber}: {error.message}</p>)}
          {preview.errorsTruncated && <p>Показаны первые 100 ошибок. После импорта можно скачать полный список.</p>}
        </div>}
        <p className="text-xs text-neutral-500">Импортируются только корректные записи. Дубли определяются по ID отзыва в пределах товара; без ID одинаковые тексты сохраняются отдельно.</p>
      </div>}
      <button className="btn-primary" disabled={busy || !verified || !preview?.mapping.text || !preview.validCount || (!productId && !productName?.trim())}
        onClick={importFile}>{upload.isPending ? 'Импорт…' : 'Импортировать корректные записи'}</button>
    </div>}

    {result && <div className="card space-y-2" role="status">
      <p className="font-semibold">{result.status === 'partial' ? 'Импорт завершён с ошибками строк' : 'Импорт завершён'}</p>
      <p>Прочитано: {result.totalCount}. Принято: {result.validCount}. Добавлено: {result.count}. Дубли: {result.skippedCount}. Ошибки: {result.errorCount}.</p>
      {result.errorCount > 0 && <button className="btn-secondary" disabled={downloading} onClick={downloadErrors}>Скачать ошибки CSV</button>}
    </div>}
  </div>;
}
