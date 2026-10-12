import { requireOwnedProduct } from './ownership.service.js';
import { HttpError } from '../middleware/error.js';
import { prisma } from '../lib/prisma.js';

export interface ProductWithStats {
  id: string;
  name: string;
  sourceUrl: string | null;
  source: string | null;
  externalId: string | null;
  reviewsCount: number;
  analyzedCount: number;
  avgRating: number | null;
  createdAt: Date;
}

export async function listProducts(userId: string): Promise<ProductWithStats[]> {
  const products = await prisma.product.findMany({
    where: { userId },
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
      source: p.source,
      externalId: p.externalId,
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

export async function createProduct(name: string, userId: string) {
  return prisma.product.create({ data: { name, userId, source: 'local' },
    select: { id: true, name: true, source: true, externalId: true, sourceUrl: true, createdAt: true } });
}

export async function getProduct(id: string, userId: string) {
  const product = await prisma.product.findFirst({ where: { id, userId },
    select: { id: true, name: true, source: true, externalId: true, sourceUrl: true, createdAt: true,
      _count: { select: { reviews: true } } } });
  if (!product) throw new HttpError(404, 'Товар не найден');
  return product;
}

export async function renameProduct(id: string, name: string, userId: string): Promise<ProductWithStats | null> {
  const existing = await prisma.product.findFirst({ where: { id, userId } });
  if (!existing) return null;
  await prisma.product.updateMany({ where: { id, userId }, data: { name } });
  const products = await listProducts(userId);
  return products.find((p) => p.id === id) ?? null;
}

export async function removeProduct(id: string, userId: string): Promise<void> {
  await requireOwnedProduct(userId, id);
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Product" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
    if (!locked.length) throw new HttpError(404, 'Товар не найден');
    if (await tx.analysisRun.count({ where: { productId: id, status: { in: ['queued', 'running'] } } })) {
      throw new HttpError(409, 'Сначала остановите активный анализ');
    }
    // Artifact cleanup and historical data deletion are implemented with the new pipeline.
    if (await tx.analysisRun.count({ where: { productId: id } })) {
      throw new HttpError(409, 'Удаление товара с историей запусков ещё не поддерживается');
    }
    await tx.report.deleteMany({ where: { productId: id, userId } });
    await tx.problem.deleteMany({ where: { productId: id } });
    await tx.hiddenIssue.deleteMany({ where: { productId: id } });
    await tx.review.deleteMany({ where: { productId: id, product: { userId } } });
    await tx.uploadBatch.deleteMany({ where: { productId: id, userId } });
    await tx.product.deleteMany({ where: { id, userId } });
  });
}
