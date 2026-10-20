import { requireOwnedProduct } from './ownership.service.js';
import { HttpError } from '../middleware/error.js';
import { prisma } from '../lib/prisma.js';
import fs from 'node:fs/promises';
import { REPORTS_DIR } from './reports.service.js';
import { containedFile } from './retention.service.js';
import { logger } from '../lib/logger.js';
import { countCurrentAnalyses } from './current-reviews.js';

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
  latestRun: { id: string; status: string; total: number; succeeded: number; failed: number; createdAt: Date; finishedAt: Date | null } | null;
}

export async function listProducts(userId: string): Promise<ProductWithStats[]> {
  const products = await prisma.product.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { reviews: true } },
      reviews: {
        select: { rating: true },
      },
      analysisRuns: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
        select: { id: true, status: true, total: true, succeeded: true, failed: true, createdAt: true, finishedAt: true } },
    },
  });

  return Promise.all(products.map(async (p) => {
    const ratings = p.reviews.map((r) => r.rating).filter((r): r is number => r !== null);
    const analyzedCount = await countCurrentAnalyses(userId, p.id);
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
      latestRun: p.analysisRuns[0] ?? null,
    };
  }));
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
  const files = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8018214)`;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Product" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
    if (!locked.length) throw new HttpError(404, 'Товар не найден');
    if (await tx.uploadBatch.count({ where: { productId: id, status: { in: ['pending', 'running'] } } })) {
      throw new HttpError(409, 'Сначала завершите или остановите импорт');
    }
    if (await tx.analysisRun.count({ where: { productId: id, status: { in: ['queued', 'running'] } } })) {
      throw new HttpError(409, 'Сначала остановите активный анализ');
    }
    if (await tx.report.count({ where: { productId: id, status: { in: ['queued', 'running'] } } })) {
      throw new HttpError(409, 'Дождитесь завершения генерации отчёта');
    }
    const artifacts = await tx.report.findMany({ where: { productId: id }, select: { filePath: true } });
    await tx.$queryRaw`SELECT set_config('reviewlens.purge_product', ${id}, true)`;
    await tx.product.update({ where: { id }, data: { publishedGroupingId: null } });
    await tx.report.deleteMany({ where: { productId: id } });
    await tx.issueClusterMember.deleteMany({ where: { cluster: { productId: id } } });
    await tx.issueClusterSnapshot.deleteMany({ where: { productId: id } });
    // Delete history leaves first; preserve the restrictive foreign keys in normal operations.
    while ((await tx.groupingPublication.deleteMany({ where: { productId: id, edits: { none: {} } } })).count) { /* History DAG. */ }
    while ((await tx.analysisRun.deleteMany({ where: { productId: id, nextRuns: { none: {} } } })).count) { /* Retry DAG. */ }
    await tx.problem.deleteMany({ where: { productId: id } });
    await tx.hiddenIssue.deleteMany({ where: { productId: id } });
    await tx.review.deleteMany({ where: { productId: id, product: { userId } } });
    await tx.uploadBatch.deleteMany({ where: { productId: id, userId } });
    await tx.product.deleteMany({ where: { id, userId } });
    return artifacts.map(report => report.filePath);
  }, { timeout: 30000 });
  for (const file of files) {
    if (!containedFile(REPORTS_DIR, file)) continue;
    const stat = await fs.lstat(file).catch(() => null);
    if (stat?.isFile()) await fs.unlink(file).catch(() => logger.warn({ productId: id }, 'Orphan report retained for storage cleanup'));
  }
}
