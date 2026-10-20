import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { boundedJson } from '../lib/bounded-json.js';
import { LIMITS } from '../lib/resource-limits.js';
import { HttpError } from '../middleware/error.js';
import { persistImport } from './imports.service.js';
import { logger } from '../lib/logger.js';

export interface ParsedReview { text: string; rating?: number; date?: Date; externalId?: string }
export function extractWbId(value: string): number {
  let id = value.trim();
  if (!/^\d+$/.test(id)) {
    let url: URL;
    try { url = new URL(id); } catch { throw new HttpError(422, 'Не удалось извлечь ID товара из ссылки Wildberries'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
      || !(url.hostname === 'wildberries.ru' || url.hostname.endsWith('.wildberries.ru'))) {
      throw new HttpError(422, 'Не удалось извлечь ID товара: нужна ссылка Wildberries или артикул');
    }
    id = /^\/catalog\/([1-9]\d*)\/(?:detail\.aspx)?$/.exec(url.pathname)?.[1] ?? '';
  }
  const result = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(result)) throw new HttpError(422, 'Не удалось извлечь ID товара из ссылки Wildberries');
  return result;
}
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new HttpError(409, 'Загрузка отменена', undefined, 'source_cancelled');
}
async function requestSource(url: string, maxBytes: number, signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    cancelled(signal);
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]), headers: { Accept: 'application/json' } });
      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(response.status === 429 ? 429 : 503, 'Источник временно недоступен. Повторите позже либо загрузите CSV.', undefined,
          response.status === 429 ? 'source_rate_limited' : response.status === 404 ? 'source_not_found' : 'source_unavailable');
      }
      try { return await boundedJson(response, maxBytes); }
      catch { throw new HttpError(503, 'Источник изменил формат ответа или превысил размер. Загрузите CSV.', undefined, 'source_format_changed'); }
    } catch (error) {
      cancelled(signal);
      if (error instanceof HttpError && ['source_format_changed', 'source_not_found'].includes(error.code ?? '')) throw error;
      if (attempt === 1) throw error instanceof HttpError ? error : new HttpError(503, 'Источник недоступен. Повторите позже либо загрузите CSV.', undefined, 'source_unavailable');
      await delay(300 * (attempt + 1), undefined, { signal }).catch(() => cancelled(signal));
    }
  }
}

/** Three in-flight probes maximum; abort probes as soon as a card is found. */
async function fetchWbImtId(nmId: number, signal?: AbortSignal) {
  const stopping = new AbortController();
  const combined = signal ? AbortSignal.any([signal, stopping.signal]) : stopping.signal;
  let next = 1; let found: number | undefined; let lastError: unknown;
  async function probe() {
    while (!combined.aborted && next <= 25 && !found) {
      const basket = next++;
      const url = `https://basket-${String(basket).padStart(2, '0')}.wbbasket.ru/vol${Math.floor(nmId / 1e5)}/part${Math.floor(nmId / 1e3)}/${nmId}/info/ru/card.json`;
      try {
        const result = z.object({ imt_id: z.number().int().positive().safe(), nm_id: z.number().optional() }).safeParse(await requestSource(url, 65536, combined));
        if (!result.success || (result.data.nm_id !== undefined && result.data.nm_id !== nmId)) throw new HttpError(503, 'Карточка товара изменила формат. Загрузите CSV.', undefined, 'source_format_changed');
        if (!found) { found = result.data.imt_id; stopping.abort(); } return;
      } catch (error) { if (!combined.aborted) lastError = error; }
    }
  }
  await Promise.all([probe(), probe(), probe()]);
  cancelled(signal);
  if (found) return found;
  throw lastError instanceof HttpError ? lastError : new HttpError(503, 'Не удалось получить карточку товара. Повторите позже либо загрузите CSV.', undefined, 'source_unavailable');
}

const feedbackSchema = z.object({
  id: z.union([z.string().min(1).max(200), z.number().int().nonnegative().safe()]),
  text: z.string().optional(), pros: z.string().optional(), cons: z.string().optional(),
  productValuation: z.number().optional(), createdDate: z.string().optional(),
  nmId: z.number().int().positive().optional(), productDetails: z.object({ nmId: z.number().int().positive() }).optional(),
});
async function fetchFeedbacks(imtId: number, nmId: number, signal?: AbortSignal) {
  let lastError: unknown;
  for (const [host, version] of [['feedbacks2', 'v2'], ['feedbacks1', 'v2'], ['feedbacks2', 'v1'], ['feedbacks1', 'v1']]) {
    cancelled(signal);
    try {
      const envelope = z.object({ feedbacks: z.array(z.unknown()) }).safeParse(await requestSource(`https://${host}.wb.ru/feedbacks/${version}/${imtId}`, LIMITS.sourceBytes, signal));
      if (!envelope.success) throw new HttpError(503, 'Источник изменил формат. Загрузите CSV.', undefined, 'source_format_changed');
      if (envelope.data.feedbacks.length > LIMITS.sourceRows) throw new HttpError(413, 'Источник вернул больше 2000 отзывов. Загрузите CSV с нужной областью.', undefined, 'source_limit');
      const rows: ParsedReview[] = []; let ignored = 0;
      for (const raw of envelope.data.feedbacks) {
        const parsed = feedbackSchema.safeParse(raw);
        if (!parsed.success) throw new HttpError(503, 'Источник изменил формат отзывов. Загрузите CSV.', undefined, 'source_format_changed');
        const fb = parsed.data;
        const identity = fb.productDetails?.nmId ?? fb.nmId;
        if (!identity) throw new HttpError(503, 'Источник не указал артикул отзыва. Безопасная загрузка невозможна; используйте CSV.', undefined, 'source_format_changed');
        if (identity !== nmId) { ignored++; continue; }
        const text = [fb.text, fb.pros && `Плюсы: ${fb.pros}`, fb.cons && `Минусы: ${fb.cons}`].filter(part => part?.trim()).join('\n');
        if (!text.trim()) { ignored++; continue; }
        if (text.length > 10000) throw new HttpError(413, 'Текст отзыва превышает 10 000 символов. Используйте CSV.', undefined, 'source_limit');
        const date = fb.createdDate ? new Date(fb.createdDate) : undefined;
        rows.push({ externalId: String(fb.id), text, rating: Number.isInteger(fb.productValuation) && fb.productValuation! >= 1 && fb.productValuation! <= 5 ? fb.productValuation : undefined,
          date: date && Number.isFinite(+date) ? date : undefined });
      }
      return { rows, received: envelope.data.feedbacks.length, ignored };
    } catch (error) {
      cancelled(signal); if (error instanceof HttpError && error.status === 413) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export async function parseWildberries(url: string, userId: string, options: { signal?: AbortSignal; batchId?: string; internalProductId?: string } = {}) {
  const productId = extractWbId(url); const canonicalUrl = `https://www.wildberries.ru/catalog/${productId}/detail.aspx`;
  logger.info({ productId }, 'WB parse started');
  const imtId = await fetchWbImtId(productId, options.signal);
  const { rows, received, ignored } = await fetchFeedbacks(imtId, productId, options.signal);
  cancelled(options.signal);
  const base = { source: 'wildberries' as const, productId, receivedCount: received, ignoredCount: ignored,
    historyComplete: false, limitation: 'Источник возвращает доступный фрагмент отзывов; полнота истории не гарантируется.' };
  if (!rows.length && !options.batchId) return { ...base, reviewsAdded: 0 };
  const result = await persistImport({ userId, productName: `WB ${productId}`, productId: options.internalProductId,
    source: 'parsing', externalSource: 'wildberries', productExternalId: String(productId),
    sourceUrl: canonicalUrl, filename: canonicalUrl, rows, batchId: options.batchId,
    diagnostics: { receivedCount: received, ignoredCount: ignored, historyComplete: false } });
  return { ...base, reviewsAdded: result.count, internalProductId: result.productId, batchId: result.batchId, skippedCount: result.skippedCount };
}
export const parseUrl = parseWildberries;
