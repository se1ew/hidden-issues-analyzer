import { Download, FileText } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

export function ReportsPage() {
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');

  const handleGenerate = () => {
    toast(`Генерация ${format.toUpperCase()} пока не реализована`, { icon: 'ℹ️' });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1>Отчёты</h1>
        <p className="text-sm text-neutral-400 mt-1">Сгенерируйте отчёт по результатам анализа</p>
      </div>

      <div className="card">
        <h3 className="mb-4">Сгенерировать отчёт</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-600 mb-2">Формат</label>
            <div className="flex gap-2">
              {(['pdf', 'docx'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`btn ${
                    format === f
                      ? 'bg-primary-300 text-neutral-700'
                      : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleGenerate} className="btn-primary">
            <FileText className="h-4 w-4" />
            Сгенерировать отчёт
          </button>
        </div>
      </div>

      <div>
        <h2 className="mb-3">История отчётов</h2>
        <div className="card text-sm text-neutral-400 text-center py-8 flex flex-col items-center gap-2">
          <Download className="h-8 w-8 text-neutral-300" />
          Пока нет сгенерированных отчётов
        </div>
      </div>
    </div>
  );
}
