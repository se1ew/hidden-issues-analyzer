// @ts-expect-error The package has no bundled TypeScript declarations.
import densityClustering from 'density-clustering';
import type { AspectCategory, IssueScope, Sentiment } from '@prisma/client';
import { GroupingSettingsSchema, type GroupingSettings } from '../schemas/grouping.schema.js';
import { canonicalText } from './aspects.js';

export interface GroupingPoint {
  id: string; reviewId: string; productId: string; runId: string; inputHash: string;
  defect: string; quote: string; quoteStart: number; quoteEnd: number;
  category: AspectCategory; aspect: string; scope: IssueScope;
  rating: number | null; sentiment: Sentiment; importedAt: Date;
  consequences: string | null;
}
export interface Coverage { total: number; succeeded: number; failed: number }
export function normalizedVector(input: unknown, dimension?: number): number[] {
  if (!Array.isArray(input) || !input.length || input.length > 8192 || (dimension !== undefined && input.length !== dimension)
    || input.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Некорректный вектор эмбеддинга');
  const norm = Math.hypot(...input);
  if (!Number.isFinite(norm) || norm < 1e-12) throw new Error('Нулевой вектор эмбеддинга');
  return input.map(value => value / norm);
}
export function cosineDistance(a: number[], b: number[]) {
  if (a.length !== b.length) throw new Error('Размерности эмбеддингов различаются');
  return Math.max(0, Math.min(2, 1 - a.reduce((sum, value, index) => sum + value * b[index], 0)));
}

export function groupMetrics(points: GroupingPoint[], coverage: Coverage, minReviews: number) {
  if (coverage.total < 0 || coverage.succeeded < 0 || coverage.failed < 0 || coverage.succeeded + coverage.failed > coverage.total) throw new Error('Некорректное покрытие');
  const reviews = [...new Map(points.map(point => [point.reviewId, point])).values()];
  const support = reviews.length;
  if (support > coverage.succeeded) throw new Error('Поддержка превышает число обработанных отзывов');
  const knownRatings = reviews.filter(point => point.rating !== null).length;
  const highRatingCount = reviews.filter(point => point.rating !== null && point.rating >= 4).length;
  const positiveSentimentCount = reviews.filter(point => point.sentiment === 'positive').length;
  const positiveContextCount = reviews.filter(point => (point.rating !== null && point.rating >= 4) || point.sentiment === 'positive').length;
  return { version: 'independent-indicators-v1', support, mentionCount: points.length,
    prevalence: coverage.succeeded ? support / coverage.succeeded : null,
    coverage: { ...coverage, remaining: coverage.total - coverage.succeeded - coverage.failed,
      ratio: coverage.total ? coverage.succeeded / coverage.total : null },
    highRatingCount, knownRatingCount: knownRatings, highRatingShare: knownRatings ? highRatingCount / knownRatings : null,
    positiveSentimentCount, sentimentDenominator: support,
    positiveSentimentShare: support ? positiveSentimentCount / support : null,
    positiveContextCount, signal: support < minReviews,
    hidden: points[0]?.scope === 'product' && positiveContextCount >= minReviews,
    consequences: points.filter(point => point.consequences !== null).map(point => ({ mentionId: point.id, quote: point.quote, text: point.consequences })),
  };
}
export type GroupMetrics = ReturnType<typeof groupMetrics>;
export interface PreparedGroup {
  points: GroupingPoint[]; title: string; defect: string; scope: IssueScope; category: AspectCategory;
  representativeIds: string[]; metrics: GroupMetrics; problemId?: string | null; needsReview?: boolean;
}

export function describeGroup(points: GroupingPoint[], coverage: Coverage, settings: GroupingSettings, vectors?: Map<string, number[]>): PreparedGroup {
  if (!points.length) throw new Error('Пустая группа');
  if (new Set(points.map(point => `${point.runId}|${point.productId}|${point.scope}|${point.category}`)).size !== 1) throw new Error('Несовместимые области группы');
  const centrality = new Map(points.map(point => [point.id, vectors
    ? points.reduce((sum, other) => sum + cosineDistance(vectors.get(point.id)!, vectors.get(other.id)!), 0) : 0]));
  const ranked = [...points].sort((a, b) => centrality.get(a.id)! - centrality.get(b.id)! || a.id.localeCompare(b.id));
  const selected: GroupingPoint[] = []; const usedReviews = new Set<string>();
  // First select the medoid, then distinct reviews farthest from existing samples.
  while (selected.length < settings.representatives) {
    const candidates = ranked.filter(point => !usedReviews.has(point.reviewId));
    if (!candidates.length) break;
    const next = !selected.length || !vectors ? candidates[0] : candidates.sort((a, b) => {
      const diversity = (point: GroupingPoint) => Math.min(...selected.map(other => cosineDistance(vectors.get(point.id)!, vectors.get(other.id)!)));
      return diversity(b) - diversity(a) || a.id.localeCompare(b.id);
    })[0];
    selected.push(next); usedReviews.add(next.reviewId);
  }
  const representative = ranked[0];
  return { points, title: `${representative.aspect}: ${representative.defect}`.slice(0, 120),
    defect: representative.defect, scope: representative.scope, category: representative.category,
    representativeIds: selected.map(point => point.id), metrics: groupMetrics(points, coverage, settings.minReviews) };
}

export function clusterMentions(points: GroupingPoint[], rawVectors: number[][], coverage: Coverage, input: GroupingSettings) {
  const settings = GroupingSettingsSchema.parse(input);
  if (points.length > settings.maxMentions) throw new Error(`Слишком много жалоб: ${points.length}; предел запуска ${settings.maxMentions}`);
  if (points.length !== rawVectors.length) throw new Error('Число эмбеддингов не совпадает с числом жалоб');
  const vectors = rawVectors.map(vector => normalizedVector(vector, rawVectors[0]?.length));
  const byId = new Map(points.map((point, index) => [point.id, vectors[index]]));
  const partitions = new Map<string, number[]>();
  points.forEach((point, index) => {
    const key = JSON.stringify([point.productId, point.runId, point.scope, point.category,
      point.category === 'other' ? canonicalText(point.aspect) : null]);
    partitions.set(key, [...(partitions.get(key) ?? []), index]);
  });
  const groups: PreparedGroup[] = [];
  for (const indices of partitions.values()) {
    const dbscan = new densityClustering.DBSCAN();
    const clusters: number[][] = dbscan.run(indices.map(index => vectors[index]), settings.epsilon, 2, cosineDistance);
    const assigned = new Set<number>();
    for (const cluster of clusters) {
      // DBSCAN chains may connect different defects. Bound the diameter as well.
      const compact: number[][] = [];
      for (const local of [...cluster].sort((a, b) => points[indices[a]].id.localeCompare(points[indices[b]].id))) {
        const index = indices[local];
        const target = compact.find(group => group.every(other => cosineDistance(vectors[index], vectors[other]) <= settings.epsilon));
        if (target) target.push(index); else compact.push([index]);
        assigned.add(index);
      }
      compact.forEach(group => groups.push(describeGroup(group.map(index => points[index]), coverage, settings, byId)));
    }
    for (const index of indices) if (!assigned.has(index)) groups.push(describeGroup([points[index]], coverage, settings, byId));
  }
  return groups.sort((a, b) => b.metrics.support - a.metrics.support || a.points[0].id.localeCompare(b.points[0].id));
}

export interface PriorGroup { id: string; problemId: string | null; scope: IssueScope; category: AspectCategory; defects: string[] }
export function stableMatches(groups: PreparedGroup[], previous: PriorGroup[]) {
  const candidates = groups.map(group => [...new Map(previous.filter(prior => prior.problemId && prior.scope === group.scope && prior.category === group.category
    && group.points.some(point => prior.defects.some(defect => canonicalText(defect) === canonicalText(point.defect))))
    .map(prior => [prior.problemId, prior])).values()]);
  return candidates.map(matches => {
    const match = matches[0];
    const unique = matches.length === 1 && candidates.filter(items => items.some(item => item.problemId === match.problemId)).length === 1;
    return { problemId: unique ? match.problemId : null, ambiguous: matches.length > 0 && !unique,
      candidateProblemIds: [...new Set(matches.map(item => item.problemId!))] };
  });
}
