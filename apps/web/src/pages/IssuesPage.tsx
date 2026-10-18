import { useState } from 'react';
import toast from 'react-hot-toast';
import { ProductSelector } from '../components/ProductSelector';
import { useProductStore } from '../store/product.store';
import { useAnalysisRuns } from '../lib/queries';
import { evidenceSegments } from '../lib/evidence';
import { useGroupings, useGroupingHistory, useGroupEvidence, useEditGrouping, useSetProblemState, useRecomputeGrouping,
  type RunGroup, type GroupingChange, type EditGroupingInput, type GroupingPreview, type ProblemStatus } from '../lib/grouping-queries';

const stateNames: Record<ProblemStatus, string> = { new: 'На проверке', confirmed: 'Подтверждена', rejected: 'Отклонена', resolved: 'Решена' };
const scopeNames: Record<string, string> = { product: 'Товар', delivery: 'Доставка', seller: 'Продавец', packaging: 'Упаковка' };
const percent = (value: number | null) => value === null ? 'не определена' : `${(value * 100).toFixed(1)}%`;
const errorText = (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Не удалось сохранить действие. Обновите данные и повторите.';

export function IssuesPage() {
  const productId = useProductStore(state => state.selectedProductId);
  return <div className="space-y-5"><div><h1>Скрытые проблемы</h1><p className="text-sm text-neutral-500">Группы жалоб и доказательства выбранного запуска</p></div>
    <ProductSelector />{productId ? <ProductGroups key={productId} productId={productId} /> : <div className="card">Выберите товар для просмотра проблем.</div>}
  </div>;
}

function ProductGroups({ productId }: { productId: string }) {
  const [runId, setRunId] = useState(''); const [publicationId, setPublicationId] = useState(''); const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<string[]>([]); const [reason, setReason] = useState('Исправление группировки');
  const [preview, setPreview] = useState<{ input: EditGroupingInput; sourceId: string; data: GroupingPreview } | null>(null);
  const groups = useGroupings(productId, runId, publicationId, page);
  const history = useGroupingHistory(productId); const runs = useAnalysisRuns(productId);
  const edit = useEditGrouping(); const recompute = useRecomputeGrouping();
  const data = groups.data; const publication = data?.publication;
  const editable = !!publication && publication.id === data?.currentPublicationId;
  const clearSelection = () => { setPage(1); setChosen([]); setPreview(null); };
  const showPreview = async (change: GroupingChange) => {
    if (!publication || !data?.currentPublicationId) return;
    const input: EditGroupingInput = { change, reason, expectedPublicationId: data.currentPublicationId, commit: false };
    try { const response = await edit.mutateAsync({ publicationId: publication.id, input }); setPreview({ input, sourceId: publication.id, data: response }); }
    catch (error) { toast.error(errorText(error)); }
  };
  const currentRun = history.data?.items.find(item => item.id === data?.currentPublicationId)?.runId;
  return <div className="space-y-4">
    <div className="card space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Запуск<select className="input mt-1" value={runId} onChange={event => { setRunId(event.target.value); setPublicationId(''); clearSelection(); }}>
          <option value="">Текущий опубликованный результат</option>
          {runs.data?.items.map(run => <option key={run.id} value={run.id}>{new Date(run.createdAt).toLocaleString('ru-RU')} · {run.succeeded}/{run.total}</option>)}
        </select></label>
        <label className="text-sm">История группировок<select className="input mt-1" value={publicationId} onChange={event => { setPublicationId(event.target.value); setRunId(''); clearSelection(); }}>
          <option value="">Автоматический выбор</option>
          {history.data?.items.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.action?.kind === 'automatic' ? 'Автоматически' : 'Правка владельца'}</option>)}
        </select></label>
        <button className="btn-soft" disabled={!publication || recompute.isPending || !editable} onClick={async () => {
          if (!publication) return;
          try { await recompute.mutateAsync(publication.runId); clearSelection(); toast.success('Новая группировка сохранена'); }
          catch (error) { toast.error(errorText(error)); }
        }}>Пересчитать группировку</button>
      </div>
      {publication && <p className="text-sm">Результат от {new Date(publication.createdAt).toLocaleString('ru-RU')}. Обработано {publication.run.succeeded} из {publication.run.total}; ошибок: {publication.run.failed}.</p>}
      {publication && !editable && <p className="text-sm text-amber-700 dark:text-amber-300">Открыта историческая публикация. Решения по карточкам показываются в их текущем состоянии.</p>}
      {publication && !editable && currentRun === publication.runId && <button className="btn-soft" disabled={edit.isPending} onClick={() => void showPreview({ kind: 'restore' })}>Восстановить эту группировку</button>}
    </div>
    {groups.isPending && <p role="status">Загрузка групп…</p>}
    {groups.isError && <div className="card" role="alert">Не удалось загрузить группы. <button className="btn-soft" onClick={() => void groups.refetch()}>Повторить</button></div>}
    {!groups.isPending && !groups.isError && !publication && <div className="card">У выбранной области пока нет успешно опубликованной группировки. Запустите анализ выбранного товара в разделе «Отзывы».</div>}
    {publication && data?.total === 0 && <div className="card">В обработанной области жалобы с проверяемыми цитатами не найдены.</div>}
    {editable && !!data?.items.length && <div className="card flex flex-wrap gap-3 items-end">
      <label className="text-sm flex-1">Причина правки<input className="input mt-1" value={reason} maxLength={500} onChange={event => { setReason(event.target.value); setPreview(null); }} /></label>
      <button className="btn-soft" disabled={chosen.length < 2 || edit.isPending || !reason.trim()} onClick={() => void showPreview({ kind: 'merge', snapshotIds: chosen })}>Объединить выбранные ({chosen.length})</button>
    </div>}
    {preview && <div className="card space-y-3 border-amber-400" role="region" aria-label="Предпросмотр группировки">
      <h2>Предпросмотр изменений</h2><p className="text-sm">Исходная публикация останется в истории. Пользовательские состояния не копируются в новые карточки объединённых или разделённых групп.</p>
      <ul className="text-sm space-y-1">{preview.data.preview.map((group, index) => <li key={index}>{group.title} — {group.metrics.support} уникальных отзывов</li>)}</ul>
      <div className="flex gap-2"><button className="btn-primary" disabled={edit.isPending} onClick={async () => {
        try { await edit.mutateAsync({ publicationId: preview.sourceId, input: { ...preview.input, commit: true } }); setPublicationId(''); setRunId(''); clearSelection(); toast.success('Правка сохранена в новой публикации'); }
        catch (error) { toast.error(errorText(error)); setPreview(null); }
      }}>Сохранить изменения</button><button className="btn-soft" onClick={() => setPreview(null)}>Отмена</button></div>
    </div>}
    {data?.items.map(group => <GroupCard key={group.id} group={group} editable={editable} chosen={chosen.includes(group.id)}
      onChoose={() => setChosen(values => values.includes(group.id) ? values.filter(id => id !== group.id) : [...values, group.id])}
      onChange={showPreview} busy={edit.isPending || !reason.trim()} />)}
    {!!data && data.total > data.pageSize && <div className="flex items-center gap-3"><button className="btn-soft" disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button>
      <span>{page} / {Math.ceil(data.total / data.pageSize)}</span><button className="btn-soft" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Вперёд</button></div>}
  </div>;
}

function GroupCard({ group, editable, chosen, onChoose, onChange, busy }: { group: RunGroup; editable: boolean; chosen: boolean; onChoose: () => void;
  onChange: (change: GroupingChange) => Promise<void>; busy: boolean }) {
  const [expanded, setExpanded] = useState(false); const [selected, setSelected] = useState<string[]>([]); const [note, setNote] = useState('');
  const state = useSetProblemState(); const m = group.metrics;
  const transitions: Record<ProblemStatus, Array<[ProblemStatus, string]>> = { new: [['confirmed', 'Подтвердить'], ['rejected', 'Отклонить'], ['resolved', 'Отметить решённой']],
    confirmed: [['resolved', 'Отметить решённой']], rejected: [['new', 'Вернуть на проверку']], resolved: [['confirmed', 'Переоткрыть']] };
  return <article className="card space-y-3">
    <div className="flex gap-3 items-start">{editable && <input type="checkbox" aria-label={`Выбрать группу: ${group.title}`} checked={chosen} onChange={onChoose} className="mt-1" />}
      <div><h2>{group.title}</h2><p className="text-sm text-neutral-500">{scopeNames[group.scope]} · {m.signal ? 'Неподтверждённый сигнал' : m.hidden ? 'Повторяющаяся жалоба в положительных отзывах' : 'Повторяющаяся жалоба'}{group.needsReview ? ' · Требует проверки' : ''}</p></div>
      {group.problem && <span className="ml-auto text-sm font-medium">{stateNames[group.problem.status]}</span>}
    </div>
    {m.recurrence && <p className="text-sm text-amber-700 dark:text-amber-300">Получено новое подтверждение после решения проблемы.</p>}
    <div className="grid sm:grid-cols-3 gap-3 text-sm">
      <p>Поддержка: <strong>{m.support}</strong> уникальных отзывов<br />В положительном контексте: {m.positiveContextCount}/{m.support}<br />Упоминаний: {m.mentionCount}</p>
      <p>Распространённость: {m.support}/{m.coverage.succeeded} ({percent(m.prevalence)})<br />Покрытие: {m.coverage.succeeded}/{m.coverage.total}; ошибок: {m.coverage.failed}</p>
      <p>Среди известных оценок: 4–5 у {m.highRatingCount}/{m.knownRatingCount} ({percent(m.highRatingShare)})<br />Положительная тональность: {m.positiveSentimentCount}/{m.sentimentDenominator} ({percent(m.positiveSentimentShare)})</p>
    </div>
    {group.representatives.map(item => <blockquote key={item.id} className="border-l-2 border-primary-400 pl-3 text-sm whitespace-pre-wrap break-words">«{item.quote}»<p className="text-xs text-neutral-500">Оценка: {item.rating ?? 'не указана'} · Последствия: {item.consequences ?? 'не определены'}</p></blockquote>)}
    {!!group.candidateProblems.length && editable && <label className="text-sm block">Неоднозначное совпадение — выберите карточку после проверки<select className="input mt-1" defaultValue="" disabled={busy} onChange={event => { if (event.target.value) void onChange({ kind: 'link', snapshotId: group.id, problemId: event.target.value }); }}>
      <option value="">Выберите карточку</option>{group.candidateProblems.map(problem => <option key={problem.id} value={problem.id}>{problem.title} · {stateNames[problem.status]}</option>)}</select></label>}
    {group.problem && editable && <div className="space-y-2"><label className="text-sm block">Комментарий к решению<input className="input mt-1" value={note} maxLength={500} onChange={event => setNote(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2">{transitions[group.problem.status].map(([status, label]) => <button className="btn-soft" key={status} disabled={state.isPending || (status === 'rejected' && !note.trim())} onClick={async () => {
        try { await state.mutateAsync({ id: group.problem!.id, status, expectedVersion: group.problem!.stateVersion, reason: note || undefined }); setNote(''); }
        catch (error) { toast.error(errorText(error)); }
      }}>{label}</button>)}</div></div>}
    {!!group.problem?.events.length && <details className="text-xs text-neutral-500"><summary>История решений</summary><ul>{group.problem.events.map(event => <li key={event.id}>{new Date(event.createdAt).toLocaleString('ru-RU')} — {stateNames[event.toStatus]}{event.reason ? `: ${event.reason}` : ''}</li>)}</ul></details>}
    <button className="btn-soft" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Скрыть доказательства' : 'Все доказательства'}</button>
    {expanded && <div className="space-y-3"><EvidenceList group={group} selected={selected} selectable={editable} onToggle={id => setSelected(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id])} />
      {editable && <button className="btn-soft" disabled={busy || !selected.length || selected.length === group.mentionIds.length} onClick={() => void onChange({ kind: 'split', snapshotId: group.id,
        parts: [selected, group.mentionIds.filter(id => !selected.includes(id))] })}>Выделить выбранные цитаты в отдельную группу</button>}</div>}
  </article>;
}

function EvidenceList({ group, selected, selectable, onToggle }: { group: RunGroup; selected: string[]; selectable: boolean; onToggle: (id: string) => void }) {
  const [page, setPage] = useState(1); const query = useGroupEvidence(group.id, page);
  if (query.isPending) return <p role="status">Загрузка доказательств…</p>;
  if (query.isError) return <p role="alert">Не удалось загрузить доказательства. <button className="btn-soft" onClick={() => void query.refetch()}>Повторить</button></p>;
  const data = query.data;
  return <div className="space-y-3">{data.items.map(item => <div key={item.id} className="rounded-lg bg-neutral-50 dark:bg-neutral-800 p-3 text-sm">
    {selectable && <label className="flex gap-2 mb-2"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />Отделить эту жалобу: «{item.quote}»</label>}
    <p className="whitespace-pre-wrap break-words">{evidenceSegments(item.text, [item], data.offsetUnit).map((segment, index) => segment.highlighted ? <mark key={index} className="bg-amber-200 text-neutral-900">{segment.text}</mark> : <span key={index}>{segment.text}</span>)}</p>
  </div>)}{data.total > data.pageSize && <div className="flex items-center gap-2"><button className="btn-soft" disabled={page === 1} onClick={() => setPage(page - 1)}>Ранее</button><span>{page} / {Math.ceil(data.total / data.pageSize)}</span><button className="btn-soft" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Далее</button></div>}</div>;
}
