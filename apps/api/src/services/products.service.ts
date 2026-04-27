import { prisma } from '../lib/prisma.js';

export interface ProductWithStats {
  id: string;
  name: string;
  sourceUrl: string | null;
  reviewsCount: number;
  analyzedCount: number;
  avgRating: number | null;
  createdAt: Date;
}

export async function listProducts(): Promise<ProductWithStats[]> {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { reviews: true } },
      reviews: {
        select: { rating: true, analyzedAt: true },
      },
    },
  });

  return products.map((p) => {
    const ratings = p.reviews.map((r) => r.rating).filter((r): r is number => r !== null);
    const analyzedCount = p.reviews.filter((r) => r.analyzedAt !== null).length;
    return {
      id: p.id,
      name: p.name,
      sourceUrl: p.sourceUrl,
      reviewsCount: p._count.reviews,
      analyzedCount,
      avgRating: ratings.length > 0 ? ratings.reduce((s, x) => s + x, 0) / ratings.length : null,
      createdAt: p.createdAt,
    };
  });
}

/**
 * Псевдо-«товар» для отзывов без productId (загружены через CSV без указания товара).
 */
export const UNASSIGNED_PRODUCT_ID = '__unassigned__';

export async function getUnassignedStats(): Promise<ProductWithStats | null> {
  const where = { productId: null };
  const [total, analyzed, avg] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.count({ where: { ...where, analyzedAt: { not: null } } }),
    prisma.review.aggregate({ where, _avg: { rating: true } }),
  ]);
  if (total === 0) return null;
  return {
    id: UNASSIGNED_PRODUCT_ID,
    name: 'Без привязки к товару',
    sourceUrl: null,
    reviewsCount: total,
    analyzedCount: analyzed,
    avgRating: avg._avg.rating,
    createdAt: new Date(0),
  };
}

/**
 * Преобразует productId из query (UI) в условие WHERE для prisma.
 * - undefined → не фильтруем (все)
 * - UNASSIGNED_PRODUCT_ID → productId: null
 * - конкретный id → productId: id
 */
export function productIdToWhere(productId?: string): { productId: string | null } | object {
  if (!productId) return {};
  if (productId === UNASSIGNED_PRODUCT_ID) return { productId: null };
  return { productId };
}
