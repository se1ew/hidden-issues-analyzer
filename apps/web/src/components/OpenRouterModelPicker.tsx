import { useState } from 'react';
import { apiErrorMessage } from '../lib/api';
import { useOpenRouterModels, type OpenRouterModel } from '../lib/queries';

const money = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 6 });
export function modelPrice(model: OpenRouterModel) {
  if (model.isFree === true) return 'Бесплатно';
  if (!model.pricing) return 'Цена не указана';
  return `Платно · $${money(model.pricing.promptPerMillion)} вход / $${money(model.pricing.completionPerMillion)} выход за 1 млн токенов`
    + (model.pricing.request ? ` + $${money(model.pricing.request)} за запрос` : '');
}

export function OpenRouterModelPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const catalog = useOpenRouterModels();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const items = catalog.data?.items ?? [];
  const selected = items.find(model => model.id === value);
  const visible = items.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(search.trim().toLowerCase())
    && (kind === 'all' || (kind === 'free' ? model.isFree === true : model.isFree === false)));
  return <div className="space-y-2 min-w-0">
    <div className="flex flex-wrap gap-2">
      <label className="flex-1 min-w-40">Поиск модели
        <input className="input w-full mt-1" value={search} onChange={event => setSearch(event.target.value)} placeholder="Название или провайдер" />
      </label>
      <label>Стоимость
        <select aria-label="Стоимость" className="input w-full mt-1" value={kind} onChange={event => setKind(event.target.value)}>
          <option value="all">Все модели</option><option value="free">Бесплатные</option><option value="paid">Платные</option>
        </select>
      </label>
    </div>
    <label className="block">Модель OpenRouter
      {catalog.isError ? <input className="input w-full mt-1" value={value} onChange={event => onChange(event.target.value)}
        required maxLength={200} placeholder="провайдер/имя-модели" autoComplete="off" />
        : <select aria-label="Модель OpenRouter" className="input w-full mt-1 min-w-0" value={value} onChange={event => onChange(event.target.value)} required>
          <option value="">{catalog.isPending ? 'Загрузка каталога…' : 'Выберите модель'}</option>
          {value && !visible.some(model => model.id === value) && <option value={value}>{selected?.name ?? value} · текущий выбор</option>}
          {[true, false, null].map(free => <optgroup key={String(free)} label={free === true ? 'Бесплатные' : free === false ? 'Платные' : 'Цена не указана'}>
            {visible.filter(model => model.isFree === free).map(model => <option key={model.id} value={model.id}>
              {model.name} · {modelPrice(model)} · {model.id}
            </option>)}
          </optgroup>)}
        </select>}
    </label>
    {catalog.isError && <p role="alert">{apiErrorMessage(catalog.error, 'Каталог временно недоступен. Можно указать ID вручную.')}
      {' '}<button type="button" className="underline" onClick={() => void catalog.refetch()}>Повторить загрузку</button></p>}
    {selected && <p className="break-words">{modelPrice(selected)}{selected.contextTokens ? ` · Контекст: ${selected.contextTokens.toLocaleString('ru-RU')} токенов` : ''}</p>}
    {value && <p className="text-xs text-neutral-500 break-all">ID: {value}</p>}
    {catalog.data && !selected && value && <p role="alert" className="text-amber-700 dark:text-amber-300">Текущей модели нет среди подходящих в каталоге. Выберите другую и сохраните настройки.</p>}
    {catalog.data && !visible.length && <p>По этому фильтру модели не найдены.</p>}
    <p className="text-xs text-neutral-500">Показаны текстовые модели с JSON-ответами. Цены из каталога OpenRouter; итоговая стоимость зависит от токенов и тарифа провайдера. Наличие в каталоге не гарантирует свободную мощность.</p>
  </div>;
}
