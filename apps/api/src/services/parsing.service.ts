import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export interface ParsedReview {
  text: string;
  rating?: number;
  date?: Date;
}

interface WbFeedbackResponse {
  feedbacks?: Array<{
    text?: string;
    productValuation?: number;
    createdDate?: string;
    pros?: string;
    cons?: string;
  }>;
}

/**
 * Парсит ID товара (nm) из URL Wildberries:
 *   https://www.wildberries.ru/catalog/123456789/detail.aspx
 *   https://global.wildberries.ru/catalog/123456789/detail.aspx?size=...
 */
function extractWbId(url: string): number | null {
  const m = url.match(/\/catalog\/(\d+)\//);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function fetchWbFeedbacksByImtId(imtId: number): Promise<ParsedReview[]> {
  // v2 содержит больше отзывов; пробуем v2 на обоих доменах, потом v1.
  const urls = [
    `https://feedbacks2.wb.ru/feedbacks/v2/${imtId}`,
    `https://feedbacks1.wb.ru/feedbacks/v2/${imtId}`,
    `https://feedbacks2.wb.ru/feedbacks/v1/${imtId}`,
    `https://feedbacks1.wb.ru/feedbacks/v1/${imtId}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as WbFeedbackResponse;
      const feedbacks = data.feedbacks ?? [];
      if (feedbacks.length === 0) continue;
      const out: ParsedReview[] = [];
      for (const fb of feedbacks) {
        const parts = [fb.text, fb.pros && `Плюсы: ${fb.pros}`, fb.cons && `Минусы: ${fb.cons}`]
          .filter((s): s is string => Boolean(s && s.trim()));
        if (parts.length === 0) continue;
        const date = fb.createdDate ? new Date(fb.createdDate) : undefined;
        out.push({
          text: parts.join('\n'),
          rating:
            fb.productValuation && fb.productValuation >= 1 && fb.productValuation <= 5
              ? fb.productValuation
              : undefined,
          date: date && !Number.isNaN(date.getTime()) ? date : undefined,
        });
      }
      return out;
    } catch (err) {
      logger.warn({ err, url }, 'wb feedbacks endpoint failed');
    }
  }
  return [];
}

/**
 * Получает imt_id из card.json. WB шардирует card.json по basket-XX.wbbasket.ru,
 * причём раскладка периодически меняется. Проще честно перебрать все шарды,
 * чем поддерживать таблицу диапазонов.
 */
async function fetchWbImtId(productId: number): Promise<number | null> {
  const vol = Math.floor(productId / 1e5);
  const part = Math.floor(productId / 1e3);

  // Параллельный запрос ко всем шардам — кто первый ответил 200, тот и наш
  const candidates = Array.from({ length: 25 }, (_, i) => {
    const host = `basket-${String(i + 1).padStart(2, '0')}.wbbasket.ru`;
    return `https://${host}/vol${vol}/part${part}/${productId}/info/ru/card.json`;
  });

  const results = await Promise.allSettled(
    candidates.map(async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { imt_id?: number };
      if (!data.imt_id) throw new Error('no imt_id');
      return data.imt_id;
    }),
  );
  for (const r of results) {
    if (r.status === 'fulfilled') return r.value;
  }
  return null;
}

export async function parseWildberries(url: string): Promise<{
  source: 'wildberries';
  productId: number;
  reviewsAdded: number;
}> {
  const productId = extractWbId(url);
  if (!productId) {
    throw new Error('Не удалось извлечь ID товара из URL Wildberries');
  }
  logger.info({ productId }, 'WB parse started');

  // Отзывы привязаны к imt_id (parent product), не к nm — сразу резолвим
  const imtId = await fetchWbImtId(productId);
  if (!imtId) {
    throw new Error('Не удалось получить карточку товара (imt_id) — возможно, товар снят с продажи');
  }
  logger.info({ productId, imtId }, 'WB resolved imt_id');

  const reviews = await fetchWbFeedbacksByImtId(imtId);

  if (reviews.length === 0) {
    logger.warn({ productId }, 'WB: no reviews found');
    return { source: 'wildberries', productId, reviewsAdded: 0 };
  }

  // Создаём Product и Reviews
  const product = await prisma.product.create({
    data: { name: `WB ${productId}`, sourceUrl: url },
  });

  await prisma.review.createMany({
    data: reviews.map((r) => ({
      text: r.text,
      rating: r.rating ?? null,
      reviewDate: r.date ?? null,
      productId: product.id,
    })),
  });

  return { source: 'wildberries', productId, reviewsAdded: reviews.length };
}

export async function parseUrl(url: string, userId: string | null) {
  if (/wildberries\.ru/.test(url)) {
    const result = await parseWildberries(url);
    await prisma.uploadBatch.create({
      data: {
        userId,
        source: 'parsing',
        filename: url.slice(0, 200),
        count: result.reviewsAdded,
      },
    });
    return result;
  }
  throw new Error(
    'Поддерживается только wildberries.ru. Для других источников используйте загрузку CSV.',
  );
}
