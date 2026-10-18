import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';
import { EditGroupingSchema, ProblemStateSchema, GroupingSettingsSchema, type GroupingQuerySchema } from '../schemas/grouping.schema.js';
import { groupingPoint, mentionInclude, publishGrouping, type StoredMention, type GroupingPlan } from './clustering.service.js';
import { describeGroup, type PreparedGroup } from './grouping-engine.js';
import { filterAndSortGroups } from './grouping-filters.js';
import { assertRunPeriod } from './data-scope.js';

const metricsObject = (value: Prisma.JsonValue | null) => (value ?? {}) as Prisma.JsonObject;
function publicMention(mention: StoredMention) {
  return { id: mention.id, defect: mention.defect, quote: mention.quote, quoteStart: mention.quoteStart,
    quoteEnd: mention.quoteEnd, text: mention.analysis.input.text, rating: mention.analysis.input.rating,
    sentiment: mention.analysis.sentiment, reviewId: mention.analysis.input.sourceReviewId, consequences: mention.consequences };
}
export async function listRunGroups(userId: string, query: z.infer<typeof GroupingQuerySchema>) {
  const product = await prisma.product.findFirst({ where: { id: query.productId, userId }, select: { id: true, publishedGroupingId: true } });
  if (!product) throw new HttpError(404, 'Товар не найден');
  if (query.runId && !await prisma.analysisRun.findFirst({ where: { id: query.runId, productId: product.id, userId } })) throw new HttpError(404, 'Запуск не найден');
  const publication = await prisma.groupingPublication.findFirst({ where: { productId: product.id, sealedAt: { not: null },
    ...(query.publicationId ? { id: query.publicationId } : query.runId ? { runId: query.runId } : { id: product.publishedGroupingId ?? '' }) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { run: { select: { id: true, total: true, succeeded: true, failed: true, scope: true, status: true, embeddingVersion: true } } } });
  if (!publication) {
    if (query.publicationId) throw new HttpError(404, 'Публикация не найдена');
    return { items: [], total: 0, page: query.page, pageSize: query.pageSize, publication: null, currentPublicationId: product.publishedGroupingId };
  }
  if (query.runId && publication.runId !== query.runId) throw new HttpError(404, 'Публикация выбранного запуска не найдена');
  assertRunPeriod(publication.run.scope, query);
  const where = { publicationId: publication.id };
  // A publication is bounded by maxMentions <= 2000. Sort JSON metrics on the
  // server across the full publication before taking a page; no client filtering.
  const all = await prisma.issueClusterSnapshot.findMany({ where, orderBy: { id: 'asc' },
    include: { members: { select: { issueMentionId: true } }, problem: { include: { events: { orderBy: { stateVersion: 'desc' }, take: 5 } } } } });
  const filtered = filterAndSortGroups(all, query);
  const total = filtered.length;
  const snapshots = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  const representativeIds = snapshots.flatMap(snapshot => {
    const ids = metricsObject(snapshot.metrics).representativeIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && snapshot.members.some(member => member.issueMentionId === id)).slice(0, 8) : [];
  });
  const representatives = await prisma.issueMention.findMany({ where: { id: { in: representativeIds }, runId: publication.runId }, include: mentionInclude });
  const candidateIds = snapshots.flatMap(snapshot => {
    const ids = metricsObject(snapshot.metrics).candidateProblemIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  });
  const candidates = await prisma.problem.findMany({ where: { id: { in: candidateIds }, productId: product.id }, select: { id: true, title: true, status: true } });
  return { items: snapshots.map(({ members, severity: _severity, visibility: _visibility, hiddenScore: _hiddenScore, ...snapshot }) => ({ ...snapshot,
    mentionIds: members.map(member => member.issueMentionId), metrics: metricsObject(snapshot.metrics),
    candidateProblems: candidates.filter(candidate => (metricsObject(snapshot.metrics).candidateProblemIds as string[] | undefined)?.includes(candidate.id)),
    representatives: representativeIds.filter(id => members.some(member => member.issueMentionId === id))
      .map(id => representatives.find(mention => mention.id === id)).filter((mention): mention is StoredMention => !!mention).map(publicMention),
  })), total, page: query.page, pageSize: query.pageSize, publication, currentPublicationId: product.publishedGroupingId };
}

export async function listGroupingHistory(userId: string, productId: string) {
  if (!await prisma.product.findFirst({ where: { id: productId, userId } })) throw new HttpError(404, 'Товар не найден');
  return prisma.groupingPublication.findMany({ where: { productId, sealedAt: { not: null } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
    select: { id: true, runId: true, sourceId: true, action: true, createdAt: true, actorUserId: true, _count: { select: { snapshots: true } } } });
}

export async function groupEvidence(userId: string, snapshotId: string, page: number, pageSize: number) {
  const snapshot = await prisma.issueClusterSnapshot.findFirst({ where: { id: snapshotId,
    publication: { sealedAt: { not: null } }, run: { userId, product: { userId } } } });
  if (!snapshot) throw new HttpError(404, 'Группа не найдена');
  const where = { clusters: { some: { clusterId: snapshot.id } }, runId: snapshot.runId };
  const [items, total] = await Promise.all([
    prisma.issueMention.findMany({ where, orderBy: [{ quoteStart: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, include: mentionInclude }),
    prisma.issueMention.count({ where }),
  ]);
  return { items: items.map(publicMention), total, page, pageSize, offsetUnit: 'utf16', offsetEnd: 'exclusive' };
}

const allowedTransitions: Record<string, string[]> = { new: ['confirmed', 'rejected', 'resolved'], confirmed: ['resolved'], rejected: ['new'], resolved: ['confirmed'] };
export async function setProblemState(userId: string, problemId: string, request: z.infer<typeof ProblemStateSchema>) {
  const input = ProblemStateSchema.parse(request);
  return prisma.$transaction(async tx => {
    const found = await tx.problem.findFirst({ where: { id: problemId, product: { userId } } });
    if (!found) throw new HttpError(404, 'Проблема не найдена');
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${found.productId} AND "userId"=${userId} FOR UPDATE`;
    const current = await tx.problem.findUniqueOrThrow({ where: { id: problemId } });
    if (current.stateVersion !== input.expectedVersion) throw new HttpError(409, 'Карточка уже изменилась; обновите данные');
    if (current.status === input.status) return current;
    if (!allowedTransitions[current.status].includes(input.status)) throw new HttpError(409, 'Недопустимый переход состояния');
    const evidence = await tx.issueMention.findMany({ where: { clusters: { some: { cluster: { problemId } } } },
      select: { analysis: { select: { input: { select: { sourceReviewId: true } } } } } });
    const updated = await tx.problem.update({ where: { id: problemId }, data: { status: input.status,
      stateVersion: { increment: 1 }, resolvedAt: input.status === 'resolved' ? new Date() : null } });
    await tx.problemEvent.create({ data: { problemId, actorUserId: userId, fromStatus: current.status, toStatus: input.status,
      reason: input.reason, stateVersion: updated.stateVersion, initiator: 'owner',
      evidence: { reviewIds: [...new Set(evidence.map(item => item.analysis.input.sourceReviewId))] } } });
    return updated;
  });
}

export async function editGrouping(userId: string, publicationId: string, request: z.infer<typeof EditGroupingSchema>) {
  const input = EditGroupingSchema.parse(request);
  return prisma.$transaction(async tx => {
    const source = await tx.groupingPublication.findFirst({ where: { id: publicationId, sealedAt: { not: null }, product: { userId } },
      include: { run: true, snapshots: { include: { members: { include: { mention: { include: mentionInclude } } } } } } });
    if (!source) throw new HttpError(404, 'Публикация не найдена');
    const products = await tx.$queryRaw<Array<{ publishedGroupingId: string | null }>>`SELECT "publishedGroupingId" FROM "Product" WHERE id=${source.productId} AND "userId"=${userId} FOR UPDATE`;
    if (products[0]?.publishedGroupingId !== input.expectedPublicationId) throw new HttpError(409, 'Публикация уже изменилась; повторите предпросмотр');
    const current = await tx.groupingPublication.findUniqueOrThrow({ where: { id: input.expectedPublicationId } });
    if (current.runId !== source.runId || (input.change.kind !== 'restore' && current.id !== source.id)) throw new HttpError(409, 'Править можно текущую публикацию; восстановление доступно в пределах её запуска');
    const settings = GroupingSettingsSchema.parse((source.run.settings as Prisma.JsonObject).grouping);
    const coverage = { total: source.run.total, succeeded: source.run.succeeded, failed: source.run.failed };
    const make = (mentions: StoredMention[]) => describeGroup(mentions.map(mention => groupingPoint(mention, source.productId)), coverage, settings);
    const groups = source.snapshots.map(snapshot => ({ ...make(snapshot.members.map(member => member.mention)), problemId: snapshot.problemId, needsReview: snapshot.needsReview }));
    const indexById = new Map(source.snapshots.map((snapshot, index) => [snapshot.id, index]));
    let edited: PreparedGroup[] = groups;
    const change = input.change;
    if (change.kind === 'merge') {
      const indices = change.snapshotIds.map(id => { const index = indexById.get(id); if (index === undefined) throw new HttpError(404, 'Группа не найдена'); return index; });
      const merged = describeGroup(indices.flatMap(index => groups[index].points), coverage, settings);
      edited = groups.filter((_, index) => !indices.includes(index)).concat({ ...merged, problemId: null, needsReview: false });
    } else if (change.kind === 'split') {
      const index = indexById.get(change.snapshotId);
      if (index === undefined) throw new HttpError(404, 'Группа не найдена');
      const points = groups[index].points;
      const all = change.parts.flat();
      if (new Set(all).size !== all.length || all.length !== points.length || points.some(point => !all.includes(point.id))) throw new HttpError(422, 'Части должны разделять все упоминания ровно по одному разу');
      const split = change.parts.map(ids => ({ ...describeGroup(ids.map(id => points.find(point => point.id === id)!), coverage, settings), problemId: null, needsReview: false }));
      edited = groups.filter((_, position) => position !== index).concat(split);
    } else if (change.kind === 'link') {
      const index = indexById.get(change.snapshotId);
      if (index === undefined) throw new HttpError(404, 'Группа не найдена');
      if (!await tx.problem.findFirst({ where: { id: change.problemId, productId: source.productId } })) throw new HttpError(404, 'Проблема не найдена');
      if (groups.some((group, position) => position !== index && group.problemId === change.problemId)) throw new HttpError(409, 'Карточка уже связана с другой группой этой публикации');
      edited = groups.map((group, position) => position === index ? { ...group, problemId: change.problemId, needsReview: false } : group);
    }
    const preview = edited.map(group => ({ title: group.title, metrics: group.metrics, mentionIds: group.points.map(point => point.id), problemId: group.problemId ?? null }));
    if (!input.commit) return { preview, committed: false, publicationId: source.id, productId: source.productId };
    const plan: GroupingPlan = { runId: source.runId, settings, coverage, embeddingVersion: source.run.embeddingVersion, groups: edited };
    const publication = await publishGrouping(tx, source.run, plan, { actorUserId: userId, sourceId: source.id,
      action: { ...input.change, reason: input.reason, previousPublicationId: current.id } });
    return { preview, committed: true, publicationId: publication.id, productId: source.productId };
  }, { timeout: 30_000 });
}
