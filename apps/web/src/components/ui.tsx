import type { ReactNode, ComponentType } from 'react';
import { AlertCircle, HelpCircle, Loader2, Star, X } from 'lucide-react';
import clsx from 'clsx';
import { Modal } from './Modal';

export type Tone = 'brand' | 'positive' | 'warning' | 'negative' | 'neutral';
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        <h1>{title}</h1>
        {description && <p className="mt-1.5 text-sm text-neutral-500 max-w-3xl">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'brand',
  hint,
  detail,
}: {
  label: string;
  value: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  hint?: string;
  detail?: ReactNode;
}) {
  return (
    <article className="card metric-card">
      <div className="flex items-center justify-between gap-2">
        {Icon && (
          <span className={`metric-icon tone-${tone}`}>
            <Icon className="h-4 w-4" />
          </span>
        )}
        {hint && <MetricHint text={hint} />}
      </div>
      <p className="metric-value">{value ?? '—'}</p>
      <p className="text-sm font-medium">{label}</p>
      {detail && <p className="text-xs text-neutral-500 mt-2">{detail}</p>}
    </article>
  );
}
export function MetricHint({ text }: { text: string }) {
  return (
    <span className="metric-hint" tabIndex={0} aria-label={text}>
      <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      <span role="tooltip">{text}</span>
    </span>
  );
}
export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`status-badge tone-${tone}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}
export function SeverityBadge({ label }: { label?: string | null }) {
  return (
    <StatusBadge tone={label ? 'warning' : 'neutral'}>
      {label ?? 'Серьёзность не измерена'}
    </StatusBadge>
  );
}
export function ChartCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('card chart-card', className)}>
      <div className="flex flex-wrap justify-between items-start gap-3 mb-5">
        <div>
          <h2 className="text-base">{title}</h2>
          {description && <p className="text-xs text-neutral-500 mt-1">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
export function FilterBar({
  children,
  onReset,
  active = false,
  className,
}: {
  children: ReactNode;
  onReset?: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <section aria-label="Фильтры" className={clsx('card filter-bar', className)}>
      <div className="flex flex-wrap items-end gap-3 min-w-0">
        {children}
        {active && onReset && (
          <button className="btn-ghost" onClick={onReset}>
            <X className="h-4 w-4" />
            Сбросить
          </button>
        )}
      </div>
    </section>
  );
}
export function DataTable({
  children,
  label,
  minWidth = '48rem',
}: {
  children: ReactNode;
  label: string;
  minWidth?: string;
}) {
  return (
    <div className="data-table-scroll relative" tabIndex={0} role="region" aria-label={label}>
      <table className="data-table" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}
export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-3" style={{ width: `${95 - (i % 3) * 18}%` }} />
      ))}
    </div>
  );
}
export function ConfirmDialog({
  title,
  children,
  busy,
  onClose,
  onConfirm,
  confirmLabel = 'Удалить',
}: {
  title: string;
  children: ReactNode;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  return (
    <Modal
      title={title}
      className="!max-w-md"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="flex gap-3 text-sm leading-relaxed">
        <span className="metric-icon tone-negative shrink-0">
          <AlertCircle className="h-5 w-5" />
        </span>
        <div>{children}</div>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <button className="btn-outline" disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button className="btn-danger" disabled={busy} onClick={onConfirm}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
export function Rating({ value }: { value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-amber-700 dark:text-amber-300">
      <Star className="h-3.5 w-3.5 fill-current" />
      {value ?? '—'}
    </span>
  );
}
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  disabled,
  label,
}: {
  items: Array<{ value: T; label: string; icon?: ComponentType<{ className?: string }> }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="tabs" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          className={clsx('tab', value === item.value && 'is-active')}
          aria-pressed={value === item.value}
          disabled={disabled}
          onClick={() => onChange(item.value)}
        >
          {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
          {item.label}
        </button>
      ))}
    </div>
  );
}
