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
 * Парсит ID товара из URL Wildberries:
 *   https://www.wildberries.ru/catalog/123456789/detail.aspx
 */
function extractWbId(url: string): number | null {
  const m = url.match(/\/catalog\/(\d+)\//);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * WB-серверы шардируют товары по ID. Эта функция реплицирует логику.
 * См. https://github.com/glmaster/wildberries-api для пояснений.
 */
function getWbBasketHost(productId: number): string {
  const t = Math.floor(productId / 1e5);
  if (t < 144) return 'basket-01.wbbasket.ru';
  if (t < 287) return 'basket-02.wbbasket.ru';
  if (t < 432) return 'basket-03.wbbasket.ru';
  if (t < 720) return 'basket-04.wbbasket.ru';
  if (t < 1008) return 'basket-05.wbbasket.ru';
  if (t < 1062) return 'basket-06.wbbasket.ru';
  if (t < 1115) return 'basket-07.wbbasket.ru';
  if (t < 1352) return 'basket-08.wbbasket.ru';
  if (t < 1602) return 'basket-09.wbbasket.ru';
  if (t < 1655) return 'basket-10.wbbasket.ru';
  if (t < 1853) return 'basket-11.wbbasket.ru';
  if (t < 2057) return 'basket-12.wbbasket.ru';
  if (t < 2189) return 'basket-13.wbbasket.ru';
  if (t < 2451) return 'basket-14.wbbasket.ru';
  if (t < 2654) return 'basket-15.wbbasket.ru';
  if (t < 2829) return 'basket-16.wbbasket.ru';
  if (t < 3169) return 'basket-17.wbbasket.ru';
  return 'basket-18.wbbasket.ru';
}

async function fetchWbFeedbacksByImtId(imtId: number): Promise<ParsedReview[]> {
  // Endpoint, отдающий json-список отзывов по imtId
  const urls = [
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
 * Получает imtId (он же товарный ID для отзывов) из card.json — он лежит на basket-XX.
 */
async function fetchWbImtId(productId: number): Promise<number | null> {
  const host = getWbBasketHost(productId);
  const vol = Math.floor(productId / 1e5);
  const part = Math.floor(productId / 1e3);
  const url = `https://${host}/vol${vol}/part${part}/${productId}/info/ru/card.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { imt_id?: number };
    return data.imt_id ?? null;
  } catch {
    return null;
  }
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

  // Сначала пробуем напрямую productId, потом imtId
  let reviews = await fetchWbFeedbacksByImtId(productId);
  if (reviews.length === 0) {
    const imtId = await fetchWbImtId(productId);
    if (imtId) {
      reviews = await fetchWbFeedbacksByImtId(imtId);
    }
  }

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
