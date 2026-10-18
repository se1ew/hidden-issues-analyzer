import { Prisma, type AnalysisRun } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { embed } from '../lib/embeddings.js';
import { HttpError } from '../middleware/error.js';
import { GroupingSettingsSchema, type GroupingSettings } from '../schemas/grouping.schema.js';
import { EmbeddingConfigurationSchema, embeddingVersion } from '../schemas/embedding.schema.js';
import { clusterMentions, stableMatches, type Coverage, type PreparedGroup, type GroupingPoint } from './grouping-engine.js';

export const mentionInclude = { aspect: true, analysis: { include: { input: true } } } as const;
export type StoredMention = Prisma.IssueMentionGetPayload<{ include: typeof mentionInclude }>;
export function groupingPoint(mention: StoredMention, productId: string): GroupingPoint {
  const { input, sentiment } = mention.analysis;
  if (!sentiment) throw new Error('Успешный анализ не содержит тональность');
  if (input.text.slice(mention.quoteStart, mention.quoteEnd) !== mention.quote) throw new Error('Сохранённая цитата не соответствует снимку');
  return { id: mention.id, reviewId: input.sourceReviewId, productId, runId: mention.runId, inputHash: input.inputHash,
    defect: mention.defect, quote: mention.quote, quoteStart: mention.quoteStart, quoteEnd: mention.quoteEnd,
    category: mention.aspect.category, aspect: mention.aspect.name, scope: mention.scope,
    rating: input.rating, sentiment, importedAt: input.importedAt, consequences: mention.consequences };
}
export interface GroupingPlan { runId: string; coverage: Coverage; settings: GroupingSettings; embeddingVersion: string; groups: PreparedGroup[] }

export async function prepareRunGrouping(runId: string, signal?: AbortSignal): Promise<GroupingPlan> {
  const run = await prisma.analysisRun.findUniqueOrThrow({ where: { id: runId } });
  const saved = run.settings as Prisma.JsonObject;
  if (!saved.grouping || !saved.embedding) throw new HttpError(409, 'Для старого запуска нужен новый анализ с настройками группировки');
  const settings = GroupingSettingsSchema.parse(saved.grouping);
  const embedding = EmbeddingConfigurationSchema.parse(saved.embedding);
  const coverage = { total: run.total, succeeded: run.succeeded, failed: run.failed };
  signal?.throwIfAborted();
  const mentions = await prisma.issueMention.findMany({ where: { runId, analysis: { status: 'succeeded' } },
    include: mentionInclude, orderBy: { id: 'asc' }, take: settings.maxMentions + 1 });
  if (mentions.length > settings.maxMentions) throw new HttpError(422, `В запуске больше ${settings.maxMentions} жалоб. Уменьшите область анализа.`);
  const analyses = await prisma.reviewAnalysis.findMany({ where: { runId, status: 'succeeded' }, select: { diagnostics: true } });
  if (analyses.some(item => {
    const diagnostics = item.diagnostics as Prisma.JsonObject | null;
    return diagnostics?.evidencePending && Array.isArray(diagnostics.legacyIssues) && diagnostics.legacyIssues.length;
  })) throw new HttpError(409, 'Жалобы старого формата не имеют проверяемых доказательств');
  const points = mentions.map(mention => groupingPoint(mention, run.productId));
  const vectors = await embed(points.map(point => point.defect), embedding, signal);
  signal?.throwIfAborted();
  return { runId, coverage, settings, embeddingVersion: embeddingVersion(embedding), groups: clusterMentions(points, vectors, coverage, settings) };
}

/** Must be called in the same transaction as the terminal state (or an owner edit). */
export async function publishGrouping(tx: Prisma.TransactionClient, run: AnalysisRun, plan: GroupingPlan,
  manual?: { actorUserId: string; action: Prisma.InputJsonObject; sourceId: string }) {
  if (plan.runId !== run.id || plan.coverage.succeeded !== run.succeeded || plan.coverage.failed !== run.failed
    || plan.coverage.total !== run.total || plan.groups.some(group => group.points.some(point => point.runId !== run.id || point.productId !== run.productId))) {
    throw new HttpError(409, 'Область группировки изменилась');
  }
  const products = await tx.$queryRaw<Array<{ id: string; publishedGroupingId: string | null }>>`
    SELECT id,"publishedGroupingId" FROM "Product" WHERE id=${run.productId} AND "userId"=${run.userId} FOR UPDATE`;
  const product = products[0];
  if (!product) throw new HttpError(404, 'Товар не найден');
  // A card may be absent from the immediately preceding scope and later recur.
  // Match against its sealed historical evidence, not only the last publication.
  const previous = await tx.issueClusterSnapshot.findMany({
    where: { productId: run.productId, problemId: { not: null }, publication: { sealedAt: { not: null } } },
    include: { members: { include: { mention: { select: { defect: true } } } } },
  });
  const matches = stableMatches(plan.groups, previous.map(snapshot => ({ id: snapshot.id, problemId: snapshot.problemId,
    scope: snapshot.scope, category: snapshot.category, defects: snapshot.members.map(member => member.mention.defect) })));
  const publication = await tx.groupingPublication.create({ data: { runId: run.id, productId: run.productId,
    sourceId: manual?.sourceId ?? product.publishedGroupingId, actorUserId: manual?.actorUserId,
    action: manual?.action ?? { kind: 'automatic', method: plan.settings.version, embeddingVersion: plan.embeddingVersion } } });
  for (const [index, group] of plan.groups.entries()) {
    const match = matches[index];
    const problemId = manual ? group.problemId : match.problemId;
    const ambiguous = manual ? !!group.needsReview : match.ambiguous;
    let problem = problemId ? await tx.problem.findFirst({ where: { id: problemId, productId: run.productId } }) : null;
    if (problemId && !problem) throw new HttpError(404, 'Карточка проблемы не найдена');
    if (!problem && !ambiguous && !group.metrics.signal) problem = await tx.problem.create({ data: {
      productId: run.productId, title: group.title, description: group.defect,
      events: { create: { toStatus: 'new', initiator: manual ? 'owner_grouping' : 'grouping', stateVersion: 0,
        actorUserId: manual?.actorUserId, evidence: { runId: run.id, publicationId: publication.id } } },
    } });
    const snapshot = await tx.issueClusterSnapshot.create({ data: {
      runId: run.id, productId: run.productId, publicationId: publication.id, problemId: problem?.id,
      title: group.title, defect: group.defect, scope: group.scope, category: group.category,
      needsReview: ambiguous || group.metrics.signal, reviewCount: group.metrics.support,
      analyzedCount: run.succeeded, positiveContextCount: group.metrics.positiveContextCount,
      // Legacy severity/visibility/hiddenScore intentionally remain unknown.
      metrics: { ...group.metrics, representativeIds: group.representativeIds,
        candidateProblemIds: ambiguous ? match.candidateProblemIds : [], recurrence: false },
    } });
    await tx.issueClusterMember.createMany({ data: group.points.map(point => ({ runId: run.id, clusterId: snapshot.id, issueMentionId: point.id })) });
    if (problem?.status === 'resolved' && problem.resolvedAt && !ambiguous && !manual) {
      const resolution = await tx.problemEvent.findFirst({ where: { problemId: problem.id, toStatus: 'resolved' }, orderBy: { stateVersion: 'desc' } });
      const known = ((resolution?.evidence as Prisma.JsonObject | null)?.reviewIds ?? []) as string[];
      const fresh = group.points.find(point => point.importedAt > problem.resolvedAt! && !known.includes(point.reviewId));
      if (fresh) {
        const updated = await tx.problem.update({ where: { id: problem.id }, data: { status: 'new', resolvedAt: null, stateVersion: { increment: 1 } } });
        await tx.problemEvent.create({ data: { problemId: problem.id, fromStatus: 'resolved', toStatus: 'new',
          stateVersion: updated.stateVersion, initiator: 'grouping', reason: 'new_evidence_after_resolution',
          evidence: { runId: run.id, publicationId: publication.id, snapshotId: snapshot.id, reviewId: fresh.reviewId, mentionId: fresh.id } } });
        await tx.issueClusterSnapshot.update({ where: { id: snapshot.id }, data: { metrics: { ...group.metrics,
          representativeIds: group.representativeIds, candidateProblemIds: [], recurrence: true } } });
      }
    }
  }
  await tx.groupingPublication.update({ where: { id: publication.id }, data: { sealedAt: new Date() } });
  await tx.product.update({ where: { id: run.productId }, data: { publishedGroupingId: publication.id } });
  return publication;
}

export async function recomputeRunGrouping(userId: string, runId: string) {
  const run = await prisma.analysisRun.findFirst({ where: { id: runId, userId, product: { userId }, status: { in: ['completed', 'partial'] } } });
  if (!run) throw new HttpError(404, 'Завершённый запуск не найден');
  const plan = await prepareRunGrouping(runId);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${run.productId} AND "userId"=${userId} FOR UPDATE`;
    if (await tx.analysisRun.count({ where: { productId: run.productId, status: { in: ['running', 'queued'] } } })) throw new HttpError(409, 'Дождитесь завершения анализа');
    const product = await tx.product.findUniqueOrThrow({ where: { id: run.productId }, include: { publishedGrouping: { include: { run: true } } } });
    if (product.publishedGrouping && product.publishedGrouping.run.createdAt > run.createdAt) throw new HttpError(409, 'Нельзя заменить новый результат пересчётом старого запуска');
    return publishGrouping(tx, run, plan);
  }, { timeout: 30_000 });
}
