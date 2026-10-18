import { Sparkles, Loader2, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAiSummary } from '../lib/queries';
import { Modal } from './Modal';

export function AiSummaryModal({ summary, onClose }: { summary: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(summary); setCopied(true); toast.success('Скопировано'); }
    catch { toast.error('Не удалось скопировать. Выделите текст вручную.'); }
  };
  return <Modal title="AI-сводка по товару" onClose={onClose} className="max-w-lg">
    <p className="text-xs text-neutral-500 mb-3">Автоматическая сводка требует проверки по исходным отзывам.</p>
    <p className="text-sm whitespace-pre-line break-words">{summary}</p>
    <div className="flex justify-end mt-5"><button onClick={() => void handleCopy()} className="btn-outline">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Скопировано' : 'Копировать'}</button></div>
  </Modal>;
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
