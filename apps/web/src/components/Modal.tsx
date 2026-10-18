import { useEffect, useRef, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const focusables = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
export function Modal({ title, children, onClose, className = '', drawer = false }: {
  title: string; children: ReactNode; onClose: () => void; className?: string; drawer?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null); const titleId = useId();
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = root.current!;
    const background = [...document.body.children].filter(node => !node.contains(panel)) as HTMLElement[];
    const inert = background.map(node => node.inert);
    background.forEach(node => { node.inert = true; });
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    (panel.querySelector<HTMLElement>(focusables) ?? panel).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const controls = [...panel.querySelectorAll<HTMLElement>(focusables)].filter(node => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      background.forEach((node, index) => { node.inert = inert[index]; });
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(<div className={`modal-overlay ${drawer ? 'items-stretch justify-start p-0' : 'items-center justify-center p-4'}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={root} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal-panel ${drawer ? 'h-full overflow-y-auto' : 'max-h-[90dvh] overflow-y-auto w-full max-w-2xl p-5'} ${className}`}>
      <div className="flex items-start justify-between gap-4 mb-4"><h2 id={titleId} className={drawer ? 'sr-only' : ''}>{title}</h2>
        <button type="button" className="btn-ghost shrink-0" aria-label={`Закрыть: ${title}`} onClick={onClose}>Закрыть</button></div>
      {children}
    </div>
  </div>, document.body);
}
