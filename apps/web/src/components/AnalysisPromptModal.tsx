import { Modal } from './Modal';
export function AnalysisPromptModal({ count, onAnalyze, onLater }: { count: number; onAnalyze: () => void; onLater: () => void }) {
  return <Modal title={`Добавлено отзывов: ${count}`} onClose={onLater} className="max-w-md">
    <p className="text-sm mb-5">Запустите анализ выбранного товара, чтобы получить аспекты и жалобы с цитатами. Время зависит от объёма и модели.</p>
    <div className="flex flex-wrap gap-3"><button onClick={onAnalyze} className="btn-primary">Запустить анализ сейчас</button><button onClick={onLater} className="btn-outline">Посмотреть отзывы</button></div>
  </Modal>;
}
