import { ownedProductScope } from './ownership.service.js';
import { prisma } from '../lib/prisma.js';

export async function listHiddenIssues(
  userId: string,
  productId?: string,
  page = 1,
  pageSize = 20,
) {
  const where = ownedProductScope(userId, productId);
  const [items, total] = await Promise.all([
    prisma.hiddenIssue.findMany({
      where,
      orderBy: { hiddenScore: 'desc' },
      include: { product: { select: { id: true, name: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.hiddenIssue.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function toggleResolvedIssue(id: string, userId: string) {
  const existing = await prisma.hiddenIssue.findFirst({ where: { id, ...ownedProductScope(userId) } });
  if (!existing) return null;
  const newResolved = !existing.resolved;
  return prisma.hiddenIssue.update({
    where: { id, ...ownedProductScope(userId) },
    data: { resolved: newResolved, resolvedAt: newResolved ? new Date() : null },
  });
}

export async function getHiddenIssue(id: string, userId: string) {
  const issue = await prisma.hiddenIssue.findFirst({
    where: { id, ...ownedProductScope(userId) },
  });
  if (!issue) return null;
  const reviews = await prisma.review.findMany({
    where: { ...ownedProductScope(userId, issue.productId ?? undefined),
      legacyResult: { is: { payload: { path: ['hiddenIssueId'], equals: issue.id } } } },
    select: { id: true, text: true, rating: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50,
  });
  return { ...issue, requiresReanalysis: true, reviews };
}
