import { useCheckLlm, useLlmConfiguration } from '../lib/queries';
import { ErrorState } from './QueryState';

export function LlmStatus() {
  const settings = useLlmConfiguration();
  const check = useCheckLlm();
  const error = check.error as { response?: { data?: { error?: string } } } | null;
  return <div className="card space-y-2">
    {settings.isError && <ErrorState error={settings.error} retry={settings.refetch} />}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-semibold">Модель анализа</p>
        {settings.data ? <p className="text-sm text-neutral-500 mt-1">
          {settings.data.provider === 'local' ? 'Локально' : 'Облако · OpenRouter'} · {settings.data.model}
        </p> : <p className="text-sm text-neutral-500 mt-1">{settings.isError ? 'Не удалось получить настройки модели' : 'Загрузка настроек…'}</p>}
      </div>
      <button className="btn-soft" disabled={check.isPending || !settings.data} onClick={() => check.mutate()}>
        {check.isPending ? 'Проверка…' : 'Проверить доступность'}
      </button>
    </div>
    <p className="text-xs text-neutral-500">Используется выбранный режим. При сбое локальной модели данные автоматически в облако не отправляются.</p>
    {check.isSuccess && <p role="status" className="text-sm text-green-700 dark:text-green-300">Настроенная модель доступна на сервере.</p>}
    {check.isError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error?.response?.data?.error ?? 'Не удалось связаться с сервером модели'}</p>}
  </div>;
}
