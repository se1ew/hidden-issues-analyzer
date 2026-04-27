import { Sparkles, X, Loader2, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAiSummary } from '../lib/queries';

interface Props {
  summary: string;
  onClose: () => void;
}

export function AiSummaryModal({ summary, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Скопировано');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-lg animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-2 text-primary-600">
            <Sparkles className="h-5 w-5" />
            <span className="font-semibold text-base">AI-анализ продукта</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition">
            <X className="h-4 w-4 text-neutral-400" />
          </button>
        </div>

        <div className="px-5 py-5">
          <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-line">
            {summary}
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100 dark:border-neutral-800">
          <button onClick={handleCopy} className="btn-outline gap-2 text-sm">
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
          <button onClick={onClose} className="btn-primary text-sm">Закрыть</button>
        </div>
      </div>
    </div>
  );
}

interface TriggerProps {
  productId?: string | null;
}

export function AiSummaryButton({ productId }: TriggerProps) {
  const [showModal, setShowModal] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const { mutate, isPending } = useAiSummary(productId);

  const handleClick = () => {
    mutate(undefined, {
      onSuccess: (text) => { setSummaryText(text); setShowModal(true); },
      onError: () => toast.error('Не удалось получить AI-саммари'),
    });
  };

  return (
    <>
      <button onClick={handleClick} disabled={isPending} className="btn-outline gap-2">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-primary-500" />}
        AI-анализ
      </button>
      {showModal && summaryText && <AiSummaryModal summary={summaryText} onClose={() => setShowModal(false)} />}
    </>
  );
}
