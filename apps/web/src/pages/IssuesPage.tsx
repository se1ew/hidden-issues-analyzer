import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useProductStore } from '../store/product.store';
import { evidenceSegments } from '../lib/evidence';
import { useSearchParams } from 'react-router-dom';
import { useGroupings, useGroupingHistory, useGroupEvidence, useEditGrouping, useSetProblemState, useRecomputeGrouping,
  type RunGroup, type GroupingChange, type EditGroupingInput, type GroupingPreview, type ProblemStatus, type GroupFilters, type EvidenceContext } from '../lib/grouping-queries';

const stateNames: Record<ProblemStatus, string> = { new: 'На проверке', confirmed: 'Подтверждена', rejected: 'Отклонена', resolved: 'Решена' };
const scopeNames: Record<string, string> = { product: 'Товар', delivery: 'Доставка', seller: 'Продавец', packaging: 'Упаковка' };
const categoryNames: Record<string, string> = { quality: 'Качество', functionality: 'Работоспособность', material: 'Материал', size_fit: 'Размер', appearance: 'Внешний вид', usability: 'Удобство', price: 'Цена', delivery: 'Доставка', seller: 'Продавец', packaging: 'Упаковка', other: 'Другое' };
const consequenceNames: Record<string, string> = { reported_harm: 'Автор сообщает о вреде', loss_of_use: 'Описана потеря возможности использования', reported: 'Описаны последствия', undetermined: 'Не определены' };
const percent = (value: number | null) => value === null ? 'не определена' : `${(value * 100).toFixed(1)}%`;
const errorText = (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Не удалось сохранить действие. Обновите данные и повторите.';

export function IssuesPage() {
  const productId = useProductStore(state => state.selectedProductId);
  const runId = useProductStore(state => state.selectedRunId);
  const [params, setParams] = useSearchParams();
  const requestedProduct = params.get('productId'), requestedRun = params.get('runId');
  useEffect(() => {
    if (!requestedProduct) return;
    const store = useProductStore.getState();
    if (store.selectedProductId !== requestedProduct) store.setSelectedProductId(requestedProduct);
    if (requestedRun) store.setDataScope({ runId: requestedRun, from: null, to: null });
  }, [requestedProduct, requestedRun]);
  const awaitingScope = !!requestedProduct && (productId !== requestedProduct || (!!requestedRun && runId !== requestedRun));
  return <div className="space-y-5"><div><h1>Скрытые проблемы</h1><p className="text-sm text-neutral-500">Группы жалоб и доказательства выбранного запуска</p></div>
    {awaitingScope ? <p role="status">Загрузка выбранной области…</p> : productId ? <ProductGroups key={productId} productId={productId} requestedSnapshot={params.get('snapshotId') ?? ''} requestedPublication={params.get('publicationId') ?? ''} clearTarget={() => setParams(previous => { const next = new URLSearchParams(previous); next.delete('snapshotId'); return next; }, { replace: true })} /> : <div className="card">Выберите товар для просмотра проблем.</div>}
  </div>;
}

function ProductGroups({ productId, requestedSnapshot, requestedPublication, clearTarget }: { productId: string; requestedSnapshot: string; requestedPublication: string; clearTarget: () => void }) {
  const { selectedRunId } = useProductStore();
  const runId = selectedRunId ?? '';
  const [publicationId, setPublicationId] = useState(''); const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<GroupFilters>({ sort: 'priority', direction: 'desc' });
  const [focusedId, setFocusedId] = useState<string | null>(requestedSnapshot || null);
  const [chosen, setChosen] = useState<string[]>([]); const [reason, setReason] = useState('Исправление группировки');
  const [preview, setPreview] = useState<{ input: EditGroupingInput; sourceId: string; data: GroupingPreview } | null>(null);
  useEffect(() => { setPublicationId(requestedPublication); setPage(1); setChosen([]); setPreview(null); setFocusedId(requestedSnapshot || null); }, [runId, requestedPublication, requestedSnapshot]);
  const groups = useGroupings(productId, runId, publicationId, page, { ...filters, ...(requestedSnapshot ? { snapshotId: requestedSnapshot } : {}) });
  const history = useGroupingHistory(productId);
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
  const focused = data?.items.find(group => group.id === focusedId) ?? data?.items[0];
  return <div className="space-y-4">
    {requestedSnapshot && <button className="btn-outline" onClick={clearTarget}>Все группы этой публикации</button>}
    <div className="card space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">История группировок<select className="input mt-1" value={publicationId} onChange={event => { setPublicationId(event.target.value); clearSelection(); }}>
          <option value="">Автоматический выбор</option>
          {history.data?.items.filter(item => !runId || item.runId === runId).map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.action?.kind === 'automatic' ? 'Автоматически' : 'Правка владельца'}</option>)}
        </select></label>
        <button className="btn-soft" disabled={!publication || recompute.isPending || !editable} onClick={async () => {
          if (!publication) return;
          try { await recompute.mutateAsync(publication.runId); clearSelection(); toast.success('Новая группировка сохранена'); }
          catch (error) { toast.error(errorText(error)); }
        }}>Пересчитать группировку</button>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">Аспект<select className="input mt-1" value={filters.category ?? ''} onChange={event => { setFilters({ ...filters, category: event.target.value || undefined }); clearSelection(); }}><option value="">Все аспекты</option>{Object.entries(categoryNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-sm">Состояние<select className="input mt-1" value={filters.status ?? ''} onChange={event => { setFilters({ ...filters, status: event.target.value || undefined }); clearSelection(); }}><option value="">Все состояния</option>{Object.entries(stateNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="signal">Мало подтверждений</option></select></label>
        <label className="text-sm">Минимум отзывов<input className="input mt-1 w-32" type="number" min={1} max={2000} value={filters.minSupport ?? ''} onChange={event => { setFilters({ ...filters, minSupport: event.target.value ? Number(event.target.value) : undefined }); clearSelection(); }} /></label>
        <label className="text-sm">Положительный контекст<select className="input mt-1" value={filters.minMasking ?? ''} onChange={event => { setFilters({ ...filters, minMasking: event.target.value ? Number(event.target.value) : undefined }); clearSelection(); }}><option value="">Любая доля</option><option value="0.5">От 50%</option><option value="1">100%</option></select></label>
        <label className="text-sm">Сортировка<select className="input mt-1" value={filters.sort} onChange={event => { setFilters({ ...filters, sort: event.target.value as GroupFilters['sort'] }); clearSelection(); }}><option value="priority">Алгоритмический приоритет</option><option value="support">Поддержка</option><option value="masking">Положительный контекст</option><option value="aspect">Аспект</option><option value="state">Состояние</option></select></label>
        <label className="text-sm">Порядок<select className="input mt-1" value={filters.direction} onChange={event => { setFilters({ ...filters, direction: event.target.value as 'asc' | 'desc' }); clearSelection(); }}><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select></label>
      </div>
      {publication && <p className="text-sm">Результат от {new Date(publication.createdAt).toLocaleString('ru-RU')}. Обработано {publication.run.succeeded} из {publication.run.total}; ошибок: {publication.run.failed}.</p>}
      {publication && <p className="text-xs text-neutral-500 break-all">Запуск этой публикации: {publication.runId}. Период: {publication.run.scope?.period ? `${new Date(publication.run.scope.period.from).toLocaleString('ru-RU')} — ${new Date(publication.run.scope.period.to).toLocaleString('ru-RU')}` : 'без ограничения по дате'}. Состав ограничен сохранённым снимком запуска.</p>}
      {publication && !editable && <p className="text-sm text-amber-700 dark:text-amber-300">Открыта историческая публикация. Решения по карточкам показываются в их текущем состоянии.</p>}
      {publication && !editable && currentRun === publication.runId && <button className="btn-soft" disabled={edit.isPending} onClick={() => void showPreview({ kind: 'restore' })}>Восстановить эту группировку</button>}
      {!!history.data?.items.length && editable && <details className="text-sm"><summary>История правок и отмена изменения</summary><ul className="space-y-2 mt-2">{history.data.items.filter(item => item.runId === publication?.runId).map(item => <li key={item.id}>{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.action.kind === 'automatic' ? 'Автоматическая группировка' : item.action.kind} {item.action.reason ? `· ${item.action.reason}` : ''}{item.id !== publication?.id && <button className="btn-outline ml-2" onClick={() => { setPublicationId(item.id); clearSelection(); }}>Открыть для восстановления</button>}</li>)}</ul></details>}
    </div>
    {groups.isPending && <p role="status">Загрузка групп…</p>}
    {groups.isError && <div className="card" role="alert">Не удалось загрузить группы. <button className="btn-soft" onClick={() => void groups.refetch()}>Повторить</button></div>}
    {!groups.isPending && !groups.isError && !publication && <div className="card">У выбранной области пока нет успешно опубликованной группировки. Запустите анализ выбранного товара в разделе «Отзывы».</div>}
    {!publication && data?.unpublishedRun && ['partial', 'completed'].includes(data.unpublishedRun.status) && data.unpublishedRun.succeeded > 0 && <button className="btn-outline" disabled={recompute.isPending} onClick={async () => {
      try { await recompute.mutateAsync(data.unpublishedRun!.id); toast.success('Группировка сохранена'); } catch (error) { toast.error(errorText(error)); }
    }}>Повторить группировку сохранённого запуска</button>}
    {publication && data?.total === 0 && <div className="card">По выбранным фильтрам жалобы с проверяемыми цитатами не найдены.</div>}
    {editable && !!data?.items.length && <div className="card flex flex-wrap gap-3 items-end">
      <label className="text-sm flex-1">Причина правки<input className="input mt-1" value={reason} maxLength={500} onChange={event => { setReason(event.target.value); setPreview(null); }} /></label>
      <button className="btn-soft" disabled={chosen.length < 2 || edit.isPending || !reason.trim()} onClick={() => void showPreview({ kind: 'merge', snapshotIds: chosen })}>Объединить выбранные ({chosen.length})</button>
    </div>}
    {preview && <div className="card space-y-3 border-amber-400" role="region" aria-label="Предпросмотр группировки">
      <h2>Предпросмотр изменений</h2><p className="text-sm">Исходная публикация останется в истории. Пользовательские состояния не копируются в новые карточки объединённых или разделённых групп.</p>
      <ul className="text-sm space-y-1">{preview.data.preview.map((group, index) => <li key={index}>{group.title} — {group.metrics.support} уникальных отзывов</li>)}</ul>
      <div className="flex gap-2"><button className="btn-primary" disabled={edit.isPending} onClick={async () => {
        try { await edit.mutateAsync({ publicationId: preview.sourceId, input: { ...preview.input, commit: true } }); setPublicationId(''); clearSelection(); toast.success('Правка сохранена в новой публикации'); }
        catch (error) { toast.error(errorText(error)); setPreview(null); }
      }}>Сохранить изменения</button><button className="btn-soft" onClick={() => setPreview(null)}>Отмена</button></div>
    </div>}
    {!!data?.items.length && <div className="problem-layout"><div className="problem-workspace">
      <section aria-label="Список проблем" className={`problem-list ${focusedId ? 'is-focused' : ''} space-y-2 min-w-0`}>{data.items.map(group => <div key={group.id} className={`card flex gap-3 ${focused?.id === group.id ? 'border-primary-500' : ''}`}>
        {editable && <input type="checkbox" className="self-start mt-1" aria-label={`Выбрать группу: ${group.title}`} checked={chosen.includes(group.id)} onChange={() => { setPreview(null); setChosen(values => values.includes(group.id) ? values.filter(id => id !== group.id) : [...values, group.id]); }} />}
        <button className="text-left min-w-0 flex-1" aria-pressed={focused?.id === group.id} onClick={() => setFocusedId(group.id)}><span className="font-semibold block break-words">{group.title}</span><span className="text-xs text-neutral-500 block mt-1">{categoryNames[group.category]} · {group.metrics.support} уникальных отзывов · {group.problem ? stateNames[group.problem.status] : 'Сигнал'}{group.metrics.hidden ? ' · Положительный контекст' : ''}</span></button>
      </div>)}</section>
      <section aria-label="Детали проблемы" className={`problem-detail ${focusedId ? 'is-focused' : ''} min-w-0`}><button className="problem-back btn-outline mb-3" onClick={() => setFocusedId(null)}>К списку проблем</button>{focused && <GroupCard key={focused.id} group={focused} editable={editable} onChange={showPreview} busy={edit.isPending || !reason.trim()} />}</section>
    </div></div>}
    {!!data && data.total > data.pageSize && <div className="flex items-center gap-3"><button className="btn-soft" disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button>
      <span>{page} / {Math.ceil(data.total / data.pageSize)}</span><button className="btn-soft" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Вперёд</button></div>}
  </div>;
}

function GroupCard({ group, editable, onChange, busy }: { group: RunGroup; editable: boolean;
  onChange: (change: GroupingChange) => Promise<void>; busy: boolean }) {
  const [expanded, setExpanded] = useState(false); const [selected, setSelected] = useState<string[]>([]); const [note, setNote] = useState('');
  const state = useSetProblemState(); const m = group.metrics;
  const transitions: Record<ProblemStatus, Array<[ProblemStatus, string]>> = { new: [['confirmed', 'Подтвердить'], ['rejected', 'Отклонить'], ['resolved', 'Отметить решённой']],
    confirmed: [['resolved', 'Отметить решённой']], rejected: [['new', 'Вернуть на проверку']], resolved: [['confirmed', 'Переоткрыть']] };
  return <article className="card space-y-3">
    <div className="flex flex-wrap gap-3 items-start">
      <div><h2>{group.title}</h2><p className="text-sm text-neutral-500">{categoryNames[group.category]} · {scopeNames[group.scope]} · {m.signal ? 'Неподтверждённый сигнал' : m.hidden ? 'Повторяющаяся жалоба в положительных отзывах' : 'Повторяющаяся жалоба'}{group.needsReview ? ' · Требует проверки' : ''}</p></div>
      {group.problem && <span className="ml-auto text-sm font-medium">{stateNames[group.problem.status]}</span>}
    </div>
    {m.recurrence && <p className="text-sm text-amber-700 dark:text-amber-300">Получено новое подтверждение после решения проблемы.</p>}
    {!m.consequences?.length && <p className="text-sm">Категория последствий: не определена.</p>}
    {m.signal && <p className="text-sm">Мало подтверждений. Достоверность не измерена.</p>}
    {m.priority ? <details className="text-sm"><summary>Алгоритмический приоритет · {m.priority.evidenceLabel}</summary><p>{m.priority.explanation}</p><p>{m.priority.limitation}</p><p className="text-xs">Правило: {m.priority.version}</p></details> : <p className="text-sm">Приоритет для этой публикации не рассчитан. Пересчитайте группировку для нового правила.</p>}
    <div className="grid sm:grid-cols-3 gap-3 text-sm">
      <p>Поддержка: <strong>{m.support}</strong> уникальных отзывов<br />В положительном контексте: {m.positiveContextCount}/{m.support}<br />Упоминаний: {m.mentionCount}</p>
      <p>Распространённость: {m.support}/{m.coverage.succeeded} ({percent(m.prevalence)})<br />Покрытие: {m.coverage.succeeded}/{m.coverage.total}; ошибок: {m.coverage.failed}</p>
      <p>Среди известных оценок: 4–5 у {m.highRatingCount}/{m.knownRatingCount} ({percent(m.highRatingShare)})<br />Положительная тональность: {m.positiveSentimentCount}/{m.sentimentDenominator} ({percent(m.positiveSentimentShare)})</p>
    </div>
    {!!m.consequences?.length && <div className="text-sm space-y-2">{m.consequences.map(item => <p key={item.mentionId}>{consequenceNames[item.category] ?? consequenceNames.undetermined}: «{item.text}»<br />Цитата: «{item.quote}»</p>)}</div>}
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
      {!!selected.length && <p className="text-sm">Выбрано цитат для разделения: {selected.length}. Выбор сохраняется между страницами и фильтрами. <button className="underline" onClick={() => setSelected([])}>Очистить</button></p>}
      {editable && <button className="btn-soft" disabled={busy || !selected.length || selected.length === group.mentionIds.length} onClick={() => void onChange({ kind: 'split', snapshotId: group.id,
        parts: [selected, group.mentionIds.filter(id => !selected.includes(id))] })}>Выделить выбранные цитаты в отдельную группу</button>}</div>}
  </article>;
}

function EvidenceList({ group, selected, selectable, onToggle }: { group: RunGroup; selected: string[]; selectable: boolean; onToggle: (id: string) => void }) {
  const [page, setPage] = useState(1); const [context, setContext] = useState<EvidenceContext>('all'); const query = useGroupEvidence(group.id, page, context);
  if (query.isPending) return <p role="status">Загрузка доказательств…</p>;
  if (query.isError) return <p role="alert">Не удалось загрузить доказательства. <button className="btn-soft" onClick={() => void query.refetch()}>Повторить</button></p>;
  const data = query.data;
  return <div className="space-y-3"><label className="block text-sm">Контекст доказательств<select className="input mt-1" value={context} onChange={event => { setContext(event.target.value as EvidenceContext); setPage(1); }}><option value="all">Все отзывы</option><option value="high_rating">Оценка 4–5</option><option value="positive_sentiment">Положительная тональность</option><option value="positive_context">Оценка 4–5 или положительная тональность</option></select></label><p className="text-xs text-neutral-500">Найдено упоминаний: {data.total}. Поддержка группы считается по уникальным отзывам.</p>{data.total === 0 && <p>В выбранном контексте доказательств нет.</p>}{data.items.map(item => <div key={item.id} className="rounded-lg bg-neutral-50 dark:bg-neutral-800 p-3 text-sm">
    {selectable && <label className="flex gap-2 mb-2"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />Отделить эту жалобу: «{item.quote}»</label>}
    <p className="whitespace-pre-wrap break-words">{evidenceSegments(item.text, [item], data.offsetUnit).map((segment, index) => segment.highlighted ? <mark key={index} className="bg-amber-200 text-neutral-900">{segment.text}</mark> : <span key={index}>{segment.text}</span>)}</p>
  </div>)}{data.total > data.pageSize && <div className="flex items-center gap-2"><button className="btn-soft" disabled={page === 1} onClick={() => setPage(page - 1)}>Ранее</button><span>{page} / {Math.ceil(data.total / data.pageSize)}</span><button className="btn-soft" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Далее</button></div>}</div>;
}
