// @ts-expect-error — у пакета нет типов
import densityClustering from 'density-clustering';

import { prisma } from '../lib/prisma.js';
import { embed } from '../lib/embeddings.js';
import { logger } from '../lib/logger.js';
import { chatCompletion, extractJson } from '../lib/openrouter.js';

interface ClusterSummary {
  title: string;
  description: string;
  keywords: string[];
}

interface ReviewIssuePoint {
  reviewId: string;
  reviewSentimentScore: number;
  issueText: string;
  productId: string | null;
}

/**
 * Косинусное расстояние между двумя нормированными векторами.
 * Если оба вектора L2-нормированы (наш случай), то cos_dist = 1 - dot.
 */
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return 1 - dot;
}

/**
 * Запрашивает у LLM краткое название и описание кластера на основе репрезентативных issue-фраз.
 */
async function summarizeCluster(samples: string[]): Promise<ClusterSummary> {
  const prompt = `Тебе даны короткие фразы-проблемы из отзывов покупателей, объединённые в один кластер.
Сформулируй на русском:
1) короткое название проблемы (3-7 слов)
2) одно предложение-описание (15-25 слов)
3) 3-5 ключевых слов

Отвечай ТОЛЬКО валидным JSON без пояснений и без markdown.

Фразы:
${samples.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Формат ответа:
{"title":"...","description":"...","keywords":["...","...","..."]}`;

  try {
    const content = await chatCompletion({
      messages: [
        { role: 'system', content: 'Ты — аналитик отзывов. Отвечай только валидным JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });
    const parsed = extractJson<ClusterSummary>(content);
    return {
      title: String(parsed.title ?? 'Без названия').slice(0, 120),
      description: String(parsed.description ?? '').slice(0, 400),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.slice(0, 8).map((k) => String(k).toLowerCase().slice(0, 40))
        : [],
    };
  } catch (err) {
    logger.warn({ err }, 'Cluster summary fallback');
    return {
      title: samples[0]?.slice(0, 60) ?? 'Кластер',
      description: '',
      keywords: samples.slice(0, 5).map((s) => s.slice(0, 40)),
    };
  }
}

export interface ClusterRunResult {
  clustersCreated: number;
  reviewsAssigned: number;
  noisePoints: number;
}

/**
 * Главный pipeline: собирает все issue-фразы из проанализированных отзывов,
 * считает эмбеддинги, кластеризует DBSCAN-ом ВНУТРИ КАЖДОГО ТОВАРА,
 * для каждого кластера считает size / severity / visibility / hidden_score
 * и просит LLM сформулировать заголовок.
 *
 * @param productId Если указан — пересчитывает только для этого товара. Иначе — для всех.
 */
export async function recomputeHiddenIssues(productId?: string): Promise<ClusterRunResult> {
  // 1. Собираем все issue-точки (опционально ограничиваем по товару)
  const reviewWhere = productId ? { productId } : {};
  const reviews = await prisma.review.findMany({
    where: { ...reviewWhere, analyzedAt: { not: null }, issues: { not: null as never } },
    select: { id: true, sentimentScore: true, issues: true, productId: true },
  });

  const points: ReviewIssuePoint[] = [];
  for (const r of reviews) {
    if (!Array.isArray(r.issues)) continue;
    for (const issue of r.issues as string[]) {
      if (typeof issue === 'string' && issue.trim().length > 0) {
        points.push({
          reviewId: r.id,
          reviewSentimentScore: r.sentimentScore ?? 0,
          issueText: issue,
          productId: r.productId,
        });
      }
    }
  }

  if (points.length < 3) {
    logger.warn({ points: points.length }, 'Not enough issue points to cluster');
    await resetIssuesForScope(productId);
    return { clustersCreated: 0, reviewsAssigned: 0, noisePoints: points.length };
  }

  // 2. Очищаем старые HiddenIssue только в пределах scope
  await resetIssuesForScope(productId);

  // 3. Группируем точки по productId — кластеризуем независимо
  const groups = new Map<string | null, { points: ReviewIssuePoint[]; indices: number[] }>();
  points.forEach((p, idx) => {
    const key = p.productId;
    const grp = groups.get(key) ?? { points: [], indices: [] };
    grp.points.push(p);
    grp.indices.push(idx);
    groups.set(key, grp);
  });

  let clustersCreated = 0;
  let reviewsAssigned = 0;
  let totalNoise = 0;

  for (const [groupProductId, group] of groups) {
    if (group.points.length < 2) {
      totalNoise += group.points.length;
      continue;
    }

    // Подсчёт всех отзывов в этом товаре (для visibility)
    const totalReviewsInGroup = await prisma.review.count({
      where: groupProductId === null ? { productId: null } : { productId: groupProductId },
    });

    logger.info(
      { productId: groupProductId, points: group.points.length, totalReviewsInGroup },
      'Clustering group',
    );
    const vectors = await embed(group.points.map((p) => p.issueText));

    const dbscan = new densityClustering.DBSCAN();
    const clusters: number[][] = dbscan.run(vectors, 0.35, 2, cosineDistance);
    const noise: number[] = dbscan.noise;
    totalNoise += noise.length;

    for (const clusterIndices of clusters) {
      if (clusterIndices.length < 2) continue;

      const clusterPoints = clusterIndices.map((i) => group.points[i]);
      const uniqueReviewIds = Array.from(new Set(clusterPoints.map((p) => p.reviewId)));

      const size = uniqueReviewIds.length;
      const visibility = totalReviewsInGroup > 0 ? size / totalReviewsInGroup : 0;
      const severity = avg(clusterPoints.map((p) => Math.abs(p.reviewSentimentScore)));
      const hiddenScore = severity * (1 - visibility);

      const samples = clusterPoints.slice(0, 8).map((p) => p.issueText);
      const summary = await summarizeCluster(samples);

      const hiddenIssue = await prisma.hiddenIssue.create({
        data: {
          productId: groupProductId,
          title: summary.title,
          description: summary.description,
          keywords: summary.keywords,
          size,
          severity,
          visibility,
          hiddenScore,
        },
      });

      await prisma.review.updateMany({
        where: { id: { in: uniqueReviewIds } },
        data: { hiddenIssueId: hiddenIssue.id },
      });

      clustersCreated++;
      reviewsAssigned += uniqueReviewIds.length;
    }
  }

  logger.info(
    { clustersCreated, reviewsAssigned, noisePoints: totalNoise, total: points.length },
    'Clustering complete',
  );
  return { clustersCreated, reviewsAssigned, noisePoints: totalNoise };
}

async function resetIssuesForScope(productId?: string): Promise<void> {
  // Snimaem связь с reviews и удаляем HiddenIssue в нужном scope
  if (productId) {
    const issues = await prisma.hiddenIssue.findMany({
      where: { productId },
      select: { id: true },
    });
    const ids = issues.map((i) => i.id);
    if (ids.length > 0) {
      await prisma.review.updateMany({
        where: { hiddenIssueId: { in: ids } },
        data: { hiddenIssueId: null },
      });
      await prisma.hiddenIssue.deleteMany({ where: { id: { in: ids } } });
    }
  } else {
    await prisma.review.updateMany({
      where: { hiddenIssueId: { not: null } },
      data: { hiddenIssueId: null },
    });
    await prisma.hiddenIssue.deleteMany({});
  }
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

export async function listHiddenIssues(
  productId?: string,
  page = 1,
  pageSize = 20,
) {
  const where = productId
    ? productId === '__unassigned__'
      ? { productId: null }
      : { productId }
    : {};
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

export async function getHiddenIssue(id: string) {
  const issue = await prisma.hiddenIssue.findUnique({
    where: { id },
    include: {
      reviews: {
        select: {
          id: true,
          text: true,
          rating: true,
          sentimentScore: true,
          createdAt: true,
        },
        take: 50,
        orderBy: { sentimentScore: 'asc' },
      },
    },
  });
  return issue;
}
