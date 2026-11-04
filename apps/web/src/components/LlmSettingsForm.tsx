import { useState, type FormEvent } from 'react';
import { apiErrorMessage } from '../lib/api';
import { useSaveLlmConfiguration, type LlmConfiguration } from '../lib/queries';
import { OpenRouterModelPicker } from './OpenRouterModelPicker';

export function LlmSettingsForm({ settings, onSaved }: { settings: LlmConfiguration; onSaved: () => void }) {
  const [provider, setProvider] = useState(settings.provider);
  const [cloudModel, setCloudModel] = useState(settings.cloudModel ?? '');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const save = useSaveLlmConfiguration();
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await save.mutateAsync({ provider, ...(cloudModel.trim() ? { cloudModel: cloudModel.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(clearApiKey ? { clearApiKey: true } : {}) });
      setApiKey(''); setClearApiKey(false); onSaved();
    } catch { /* The form displays the server error below. */ }
  }
  const keySaved = settings.source === 'account' && settings.hasApiKey && !clearApiKey;
  return <form onSubmit={submit} className="space-y-4 border-t border-neutral-200 dark:border-neutral-700 pt-4">
    <fieldset disabled={save.isPending} className="space-y-3">
      <legend className="font-semibold mb-2">Где выполнять анализ</legend>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2"><input type="radio" name="llm-provider" value="local" checked={provider === 'local'} onChange={() => { setProvider('local'); save.reset(); }} />Локально · CPU</label>
        <label className="flex items-center gap-2"><input type="radio" name="llm-provider" value="openrouter" checked={provider === 'openrouter'} onChange={() => { setProvider('openrouter'); save.reset(); }} />OpenRouter</label>
      </div>
      {provider === 'local' ? <div className="space-y-2 text-sm">
        {settings.local?.managed ? <>
          <p>Скачайте один GGUF-файл, переименуйте в <code>model.gguf</code> и поместите в <code>{settings.local.file}</code> на компьютере, где запущено приложение. Runtime уже входит в Docker-установку.</p>
          <p role="status">{settings.local.state === 'present' ? 'GGUF-файл найден. После загрузки runtime проверьте доступность.'
            : settings.local.state === 'invalid' ? 'Файл найден, но формат GGUF не распознан. Проверьте скачанный файл.'
            : 'Файл модели пока не найден. Приложением можно пользоваться без него.'}</p>
          <p>Для начала: <a className="underline" href="https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" target="_blank" rel="noreferrer">Qwen2.5 1.5B</a>, <a className="underline" href="https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/blob/main/qwen2.5-3b-instruct-q4_k_m.gguf" target="_blank" rel="noreferrer">Qwen2.5 3B</a> или <a className="underline" href="https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/blob/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf" target="_blank" rel="noreferrer">Qwen3 4B Instruct</a>. Выбирайте Q4_K_M; качество проверяйте на своих отзывах.</p>
          <p>Сначала завершите скачивание вне папки, затем перенесите готовый файл. Перед заменой уже работающей модели остановите приложение и запустите его снова после замены.</p>
        </> : <p>Используется внешний локальный runtime из конфигурации установки. Для варианта «только положить файл» запустите production Docker-установку по README.</p>}
        <p>Отзывы остаются на компьютере с приложением. Облачный режим автоматически не включается. CPU обрабатывает отзывы последовательно; большие партии могут занять несколько часов.</p>
      </div> : <div className="space-y-3 text-sm">
        <p>Тексты отзывов и запросы к сводке будут отправляться выбранной модели через OpenRouter. Нужны интернет и ваш API-ключ; стоимость зависит от модели.</p>
        <OpenRouterModelPicker value={cloudModel} onChange={value => { setCloudModel(value); save.reset(); }} />
        <label className="block">API-ключ OpenRouter
          <input className="input w-full mt-1" type="password" value={apiKey} onChange={event => { setApiKey(event.target.value); setClearApiKey(false); save.reset(); }} required={!keySaved} maxLength={512} autoComplete="new-password" spellCheck={false} placeholder={keySaved ? 'Ключ сохранён · введите новый для замены' : 'sk-or-v1-…'} />
        </label>
        <p>Ключ хранится на сервере в зашифрованном виде и не возвращается в браузер. <a className="underline" href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Получить ключ</a> · <a className="underline" href="https://openrouter.ai/models" target="_blank" rel="noreferrer">Каталог моделей</a></p>
      </div>}
      {provider === 'local' && settings.source === 'account' && settings.hasApiKey && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={clearApiKey} onChange={event => { setClearApiKey(event.target.checked); save.reset(); }} />Удалить сохранённый ключ OpenRouter</label>}
      <button className="btn-primary" type="submit">{save.isPending ? 'Сохранение…' : 'Сохранить режим анализа'}</button>
    </fieldset>
    {save.isError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{apiErrorMessage(save.error)}</p>}
    {save.isSuccess && <p role="status" className="text-sm text-green-700 dark:text-green-300">Настройки сохранены. Новые запуски используют выбранный режим; уже созданные сохраняют свою модель.</p>}
  </form>;
}
