import { setTimeout as delay } from 'node:timers/promises';
import { z, type ZodType } from 'zod';
import { env, type Env } from '../config/env.js';

export type LlmErrorCode = 'cancelled' | 'timeout' | 'network' | 'http' | 'invalid_response' | 'model_unavailable' | 'input_too_long';
export class LlmError extends Error {
  constructor(public code: LlmErrorCode, message: string, public status?: number) { super(message); }
}
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface CompletionRequest {
  messages: ChatMessage[]; temperature?: number; max_tokens?: number;
  jsonSchema?: Record<string, unknown>; schemaName?: string;
}
export interface ProviderConfig {
  provider: 'local' | 'openrouter'; baseUrl: string; model: string; apiKey?: string;
  timeoutMs: number; contextTokens: number; maxOutputTokens: number; concurrency: number;
  retries: number; retryDelayMs: number; maxRetryDelayMs: number;
  responseFormat: 'none' | 'json_object' | 'json_schema'; cloudDelayMs: number; webOrigin?: string;
}
export interface LlmProvider {
  readonly config: Readonly<ProviderConfig>;
  complete(request: CompletionRequest, signal?: AbortSignal): Promise<string>;
  completeJson<T>(request: CompletionRequest, schema: ZodType<T>, signal?: AbortSignal): Promise<T>;
  check(signal?: AbortSignal): Promise<void>;
}

export function providerConfig(settings: Env): ProviderConfig {
  return {
    provider: settings.LLM_PROVIDER,
    baseUrl: settings.LLM_BASE_URL ?? (settings.LLM_PROVIDER === 'local' ? 'http://127.0.0.1:8080/v1' : settings.OPENROUTER_BASE_URL),
    model: settings.LLM_MODEL ?? (settings.LLM_PROVIDER === 'local' ? 'local-model' : settings.OPENROUTER_MODEL),
    apiKey: settings.LLM_PROVIDER === 'openrouter' ? settings.OPENROUTER_API_KEY : undefined,
    timeoutMs: settings.LLM_TIMEOUT_MS, contextTokens: settings.LLM_CONTEXT_TOKENS,
    maxOutputTokens: settings.LLM_MAX_OUTPUT_TOKENS, concurrency: settings.LLM_CONCURRENCY,
    retries: settings.LLM_RETRIES, retryDelayMs: settings.LLM_RETRY_DELAY_MS,
    maxRetryDelayMs: settings.LLM_MAX_RETRY_DELAY_MS, responseFormat: settings.LLM_RESPONSE_FORMAT,
    cloudDelayMs: settings.LLM_CLOUD_DELAY_MS, webOrigin: settings.WEB_ORIGIN,
  };
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LlmError('cancelled', 'Запрос модели отменён');
}
export async function waitForLlm(ms: number, signal?: AbortSignal): Promise<void> {
  cancelled(signal);
  try { if (ms > 0) await delay(ms, undefined, { signal }); }
  catch { throw new LlmError('cancelled', 'Запрос модели отменён'); }
}

class Gate {
  private active = 0;
  private waiters: Array<{ resolve: () => void; reject: (error: Error) => void; signal?: AbortSignal; abort: () => void }> = [];
  constructor(private limit: number) {}
  async acquire(signal?: AbortSignal): Promise<() => void> {
    cancelled(signal);
    if (this.active < this.limit) this.active++;
    else await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject, signal, abort: () => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        reject(new LlmError('cancelled', 'Запрос модели отменён'));
      } };
      this.waiters.push(waiter);
      signal?.addEventListener('abort', waiter.abort, { once: true });
    });
    return () => {
      const next = this.waiters.shift();
      if (next) { next.signal?.removeEventListener('abort', next.abort); next.resolve(); }
      else this.active--;
    };
  }
}

const completionEnvelope = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }), finish_reason: z.string().optional() })).min(1),
});

export function createProvider(input: ProviderConfig): LlmProvider {
  const config = Object.freeze({ ...input });
  const gate = new Gate(config.concurrency);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.provider === 'openrouter') {
    if (!config.apiKey || /^sk-or-v1-X+$/.test(config.apiKey)) throw new Error('Для OpenRouter нужен настоящий API-ключ');
    headers.Authorization = `Bearer ${config.apiKey}`;
    headers['HTTP-Referer'] = config.webOrigin ?? '';
    headers['X-Title'] = 'ReviewLens';
  }

  async function fetchJson(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    const maxResponseBytes = (path === 'models' ? 8 : 2) * 1024 * 1024;
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers, signal: combined,
        redirect: 'error', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const retryAfter = response.headers.get('Retry-After');
        const reset = response.headers.get('X-RateLimit-Reset');
        const waitMs = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now())
          : reset ? Number(reset) - Date.now() : undefined;
        const error = new LlmError('http', `Модель вернула HTTP ${response.status}`, response.status);
        Object.assign(error, { retryAfterMs: waitMs });
        throw error;
      }
      // Bound response size; errors never expose raw provider output or review text.
      if (Number(response.headers.get('content-length')) > maxResponseBytes) {
        await response.body?.cancel(); throw new LlmError('invalid_response', 'Ответ модели слишком большой');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new LlmError('invalid_response', 'Пустой ответ модели');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > maxResponseBytes) { await reader.cancel(); throw new LlmError('invalid_response', 'Ответ модели слишком большой'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { throw new LlmError('invalid_response', 'Модель вернула невалидный JSON'); }
    } catch (error) {
      if (signal.aborted) throw new LlmError('cancelled', 'Запрос модели отменён');
      if (timeout.aborted) throw new LlmError('timeout', 'Превышено время ожидания модели');
      if (error instanceof LlmError) throw error;
      throw new LlmError('network', 'Сервер модели недоступен');
    }
  }

  async function execute<T>(operation: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
    const release = await gate.acquire(external);
    const signal = external ?? new AbortController().signal;
    try {
      for (let attempt = 0; ; attempt++) {
        cancelled(signal);
        try { return await operation(signal); }
        catch (error) {
          if (!(error instanceof LlmError)) throw error;
          const retryable = ['network', 'timeout', 'invalid_response'].includes(error.code)
            || (error.code === 'http' && [408, 429, 500, 502, 503, 504].includes(error.status ?? 0));
          const indicated = (error as LlmError & { retryAfterMs?: number }).retryAfterMs;
          if (!retryable || attempt >= config.retries || (indicated !== undefined && indicated > config.maxRetryDelayMs)) throw error;
          const ms = indicated !== undefined && Number.isFinite(indicated) ? Math.max(0, indicated)
            : Math.min(config.maxRetryDelayMs, config.retryDelayMs * 2 ** attempt);
          await waitForLlm(ms, signal);
        }
      }
    } finally { release(); }
  }

  async function completion(request: CompletionRequest, signal: AbortSignal): Promise<string> {
    const maxTokens = Math.min(request.max_tokens ?? config.maxOutputTokens, config.maxOutputTokens);
    const inputBytes = request.messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0);
    if (inputBytes > (config.contextTokens - maxTokens) * 4) {
      throw new LlmError('input_too_long', 'Текст превышает допустимый размер контекста; нужен разбор на фрагменты');
    }
    let responseFormat: unknown;
    if (request.jsonSchema && config.responseFormat !== 'none') {
      responseFormat = config.responseFormat === 'json_schema' ? {
        type: 'json_schema', json_schema: { name: request.schemaName ?? 'reviewlens_result', strict: true, schema: request.jsonSchema },
      } : { type: 'json_object' };
    }
    const raw = await fetchJson('chat/completions', { model: config.model, messages: request.messages,
      temperature: request.temperature ?? 0.2, max_tokens: maxTokens, stream: false,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }, signal);
    const parsed = completionEnvelope.safeParse(raw);
    if (!parsed.success || !parsed.data.choices[0].message.content.trim()
      || (parsed.data.choices[0].finish_reason && parsed.data.choices[0].finish_reason !== 'stop')) {
      throw new LlmError('invalid_response', 'Модель не вернула полный текстовый результат');
    }
    return parsed.data.choices[0].message.content;
  }

  return {
    config,
    complete: (request, signal) => execute((current) => completion(request, current), signal),
    completeJson: <T>(request: CompletionRequest, schema: ZodType<T>, signal?: AbortSignal) => execute(async (current) => {
      const text = await completion(request, current);
      let raw: unknown;
      try { raw = JSON.parse(text); }
      catch { throw new LlmError('invalid_response', 'Результат модели не является JSON-объектом'); }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new LlmError('invalid_response', 'Результат модели не соответствует схеме');
      return parsed.data;
    }, signal),
    check: (signal) => execute(async (current) => {
      const models = z.object({ data: z.array(z.object({ id: z.string() })) }).safeParse(await fetchJson('models', undefined, current));
      if (!models.success) throw new LlmError('invalid_response', 'Некорректный список моделей');
      if (!models.data.data.some((model) => model.id === config.model)) throw new LlmError('model_unavailable', 'Настроенная модель отсутствует на сервере');
    }, signal),
  };
}

export const llm = createProvider(providerConfig(env));
export function publicProviderConfiguration() {
  const { provider, model, contextTokens, concurrency, responseFormat } = llm.config;
  return { provider, model, contextTokens, concurrency, responseFormat };
}
