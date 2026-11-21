import { logger } from '../lib/logger.js';
import { persistImport } from './imports.service.js';
import { assertWildberriesActive, extractWbId, inspectWildberriesSource } from './wildberries-source.js';

export { extractWbId, inspectWildberriesSource } from './wildberries-source.js';
export type { ParsedReview } from './wildberries-source.js';

export async function parseWildberries(url: string, userId: string, options: { signal?: AbortSignal; batchId?: string; internalProductId?: string } = {}) {
  const productId = extractWbId(url); const canonicalUrl = `https://www.wildberries.ru/catalog/${productId}/detail.aspx`;
  logger.info({ productId }, 'WB parse started');
  const { rows, received, ignored, name, imageUrl } = await inspectWildberriesSource(url, options.signal);
  assertWildberriesActive(options.signal);
  const base = { source: 'wildberries' as const, productId, receivedCount: received, ignoredCount: ignored,
    historyComplete: false, limitation: 'Источник возвращает доступный фрагмент отзывов; полнота истории не гарантируется.' };
  if (!rows.length && !options.batchId) return { ...base, reviewsAdded: 0 };
  const result = await persistImport({ userId, productName: name ?? `WB ${productId}`, imageUrl, productId: options.internalProductId,
    source: 'parsing', externalSource: 'wildberries', productExternalId: String(productId),
    sourceUrl: canonicalUrl, filename: canonicalUrl, rows, batchId: options.batchId,
    diagnostics: { receivedCount: received, ignoredCount: ignored, historyComplete: false } });
  return { ...base, reviewsAdded: result.count, internalProductId: result.productId, batchId: result.batchId, skippedCount: result.skippedCount };
}
export const parseUrl = parseWildberries;
