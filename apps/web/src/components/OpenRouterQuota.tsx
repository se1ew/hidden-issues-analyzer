import { apiErrorMessage } from '../lib/api';
import { useOpenRouterLimits } from '../lib/queries';

export function OpenRouterQuota({ hasApiKey }: { hasApiKey: boolean }) {
  const limits = useOpenRouterLimits(hasApiKey);
  const data = limits.data;
  const free = data?.freeRequests;
  return <div className="rounded-xl bg-primary-50 dark:bg-neutral-800 p-3 space-y-1 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-semibold">Лимиты OpenRouter</p>
      <button type="button" className="underline" disabled={!hasApiKey || limits.isFetching} onClick={() => void limits.refetch()}>
        {limits.isFetching ? 'Обновление…' : 'Обновить лимиты'}
      </button>
    </div>
    {!hasApiKey ? <p>Сохраните свой API-ключ в профиле, чтобы увидеть остаток.</p>
      : limits.isError ? <p role="alert">{apiErrorMessage(limits.error, 'Не удалось обновить лимиты. Остаток сейчас неизвестен.')}</p>
        : !data ? <p>Загрузка лимитов…</p> : <>
          {free ? <>
            <p className={free.remaining === 0 ? 'text-red-700 dark:text-red-300' : ''}>Бесплатные запросы: осталось <strong>{free.remaining} из {free.limit}</strong> за сутки · использовано {free.used}.</p>
            <p className="text-xs text-neutral-500">Обновление суточного счётчика: {new Date(free.resetAt).toLocaleString('ru-RU')} по вашему времени (расчёт по правилу 00:00 UTC).</p>
          </> : <p>OpenRouter не сообщил точный остаток бесплатных запросов.</p>}
          <p className="text-xs text-neutral-500">Общий счётчик аккаунта для бесплатных моделей, полученный по вашему сохранённому ключу. Переключение модели или ключа его не обнуляет. Остаток поминутного лимита не предоставлен.</p>
          {data.keyCredits && <p className="text-xs text-neutral-500">{data.keyCredits.limit === null
            ? 'Лимит расходов ключа не задан. Это не баланс аккаунта.'
            : `Лимит расходов ключа: $${data.keyCredits.limit}; остаток: ${data.keyCredits.remaining === null ? 'не предоставлен' : `$${data.keyCredits.remaining}`}.`}</p>}
          <p className="text-xs text-neutral-500">Проверено: {new Date(data.checkedAt).toLocaleString('ru-RU')}. Один отзыв может потребовать несколько запросов; повторные попытки и сводки тоже расходуют лимит.</p>
        </>}
    {limits.isError && data && <p className="text-xs text-neutral-500">Последняя успешная проверка: {new Date(data.checkedAt).toLocaleString('ru-RU')}; прежний остаток устарел.</p>}
  </div>;
}
