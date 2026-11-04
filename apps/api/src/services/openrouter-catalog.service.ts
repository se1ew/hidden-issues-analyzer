import { z } from 'zod';
import { env } from '../config/env.js';
import { boundedJson } from '../lib/bounded-json.js';
import { HttpError } from '../middleware/error.js';
import { decryptApiKey, savedLlmSettings } from './llm-settings.service.js';

async function requestOpenRouter(path: 'models' | 'key', apiKey?: string, signal?: AbortSignal) {
  try {
    const response = await fetch(`${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/${path}`, {
      redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]),
      headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(503, response.status === 401 || response.status === 403
        ? 'OpenRouter отклонил ключ или доступ к лимитам. Проверьте API-ключ в профиле.'
        : response.status === 429 ? 'OpenRouter временно ограничил запросы. Обновите сведения позже.'
          : 'Не удалось получить сведения OpenRouter. Повторите позже.', undefined, 'openrouter_unavailable');
    }
    return await boundedJson(response, path === 'models' ? 8 * 1024 * 1024 : 65536);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'Сведения OpenRouter временно недоступны. Повторите позже.', undefined, 'openrouter_unavailable');
  }
}

function price(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed * 1e6) && parsed >= 0 ? parsed : null;
}
const modelSchema = z.object({
  id: z.string().min(1).max(200), name: z.string().max(300).optional(),
  context_length: z.number().int().positive().optional(),
  architecture: z.object({ input_modalities: z.array(z.string()), output_modalities: z.array(z.string()) }),
  supported_parameters: z.array(z.string()), endpoints: z.array(z.string()).optional(),
  pricing: z.object({ prompt: z.unknown(), completion: z.unknown(), request: z.unknown().optional() }),
});
export async function openRouterModels(signal?: AbortSignal) {
  const envelope = z.object({ data: z.array(z.unknown()).max(5000) }).safeParse(await requestOpenRouter('models', undefined, signal));
  if (!envelope.success) throw new HttpError(503, 'OpenRouter вернул некорректный каталог моделей. Повторите позже.');
  const items = envelope.data.data.flatMap(raw => {
    const parsed = modelSchema.safeParse(raw);
    if (!parsed.success) return [];
    const model = parsed.data;
    if (!model.architecture.input_modalities.includes('text') || !model.architecture.output_modalities.includes('text')
      || (model.endpoints && !model.endpoints.includes('/api/v1/chat/completions'))
      || !model.supported_parameters.includes('response_format')) return [];
    const prompt = price(model.pricing.prompt), completion = price(model.pricing.completion);
    const request = model.pricing.request === undefined ? 0 : price(model.pricing.request);
    const known = prompt !== null && completion !== null && request !== null;
    return [{ id: model.id, name: model.name ?? model.id, contextTokens: model.context_length ?? null,
      isFree: known ? prompt === 0 && completion === 0 && request === 0 : null,
      pricing: known ? { promptPerMillion: prompt * 1e6, completionPerMillion: completion * 1e6, request } : null }];
  }).sort((a, b) => Number(b.isFree === true) - Number(a.isFree === true) || a.name.localeCompare(b.name));
  if (!items.length) throw new HttpError(503, 'В каталоге OpenRouter не найдены подходящие текстовые модели с JSON-ответами.');
  return { items, fetchedAt: new Date().toISOString() };
}

const counterSchema = z.object({ used: z.number().int().nonnegative().safe(), limit: z.number().int().nonnegative().safe(),
  remaining: z.number().int().nonnegative().safe() }).refine(value => value.remaining <= value.limit);
const dollars = z.number().finite().nullable();
const keySchema = z.object({ data: z.object({
  free_model_daily_requests: counterSchema.nullable().optional().catch(null),
  limit: dollars.optional().catch(undefined), limit_remaining: dollars.optional().catch(undefined),
  limit_reset: z.string().max(100).nullable().optional().catch(null),
}) });

export async function openRouterLimits(userId: string, signal?: AbortSignal) {
  const saved = await savedLlmSettings(userId);
  const apiKey = saved ? saved.encryptedKey ? decryptApiKey(saved.encryptedKey, userId) : undefined : env.OPENROUTER_API_KEY;
  if (!apiKey) throw new HttpError(409, 'Сохраните свой API-ключ OpenRouter в профиле, чтобы увидеть лимиты.', undefined, 'openrouter_key_required');
  const parsed = keySchema.safeParse(await requestOpenRouter('key', apiKey, signal));
  if (!parsed.success) throw new HttpError(503, 'OpenRouter вернул некорректные сведения о лимитах.');
  const data = parsed.data.data;
  const now = new Date();
  // The API reports a UTC-day counter, not an exact reset timestamp. Derive the
  // next day from that documented policy and identify this derivation in the UI.
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  return { checkedAt: now.toISOString(), scope: 'account' as const,
    freeRequests: data.free_model_daily_requests ? { ...data.free_model_daily_requests, resetAt, resetBasis: 'utc_day' as const } : null,
    keyCredits: data.limit !== undefined && data.limit_remaining !== undefined
      ? { limit: data.limit, remaining: data.limit_remaining, reset: data.limit_reset ?? null } : null };
}
