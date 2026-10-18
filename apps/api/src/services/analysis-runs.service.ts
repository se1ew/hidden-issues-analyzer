import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type AnalysisRun } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { llm } from '../lib/llm.js';
import { HttpError } from '../middleware/error.js';
import { EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION, EXTRACTION_METHOD_VERSION, ExtractionResultSchema, prepareExtraction, type ExtractionResult } from './extraction.service.js';
import { CreateAnalysisRunSchema, type CreateAnalysisRunInput, type ListAnalysisRunsInput, type ListAnalysisInputsInput } from '../schemas/analysis-runs.schema.js';
import { env } from '../config/env.js';
import { defaultEmbeddingConfiguration } from '../lib/embeddings.js';
import { embeddingVersion } from '../schemas/embedding.schema.js';
import { GroupingSettingsSchema } from '../schemas/grouping.schema.js';
import { publishGrouping, type GroupingPlan } from './clustering.service.js';
import { AnalysisResultSchema, type AnalysisResult } from './analyzer.service.js';

export const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const;

export function publicAnalysisRun(run: AnalysisRun) {
  const settings = run.settings as Prisma.JsonObject;
  return { id: run.id, runId: run.id, productId: run.productId, previousRunId: run.previousRunId,
    resultsDisposition: ['cancelled', 'interrupted'].includes(run.status) ? 'retained_unpublished' : 'run_scoped',
    status: run.status, stage: run.stage,
    scope: run.scope, provider: run.provider, model: run.model, modelVersion: run.modelVersion,
    promptVersion: run.promptVersion, methodVersion: run.methodVersion, embeddingVersion: run.embeddingVersion,
    limitations: ['Качество модели и вероятность ошибок не измерены.', 'Жалобы подтверждают описанный опыт автора, а не причину дефекта.', 'Результат относится только к сохранённой области отзывов.'],
    total: run.total, succeeded: run.succeeded, failed: run.failed,
    processed: run.succeeded + run.failed, remaining: run.total - run.succeeded - run.failed,
    stateVersion: run.stateVersion, heartbeatAt: run.heartbeatAt, cancelRequestedAt: run.cancelRequestedAt,
    createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt,
    finishReason: run.finishReason, diagnostics: run.diagnostics,
    configuration: { contextTokens: settings.contextTokens, maxOutputTokens: settings.maxOutputTokens,
      timeoutMs: settings.timeoutMs, concurrency: settings.concurrency, responseFormat: settings.responseFormat },
  };
}

export function inputHash(review: { text: string; rating: number | null; reviewDate: Date | null; inputVersion: number }) {
  return createHash('sha256').update(JSON.stringify({ text: review.text, rating: review.rating,
    reviewDate: review.reviewDate?.toISOString() ?? null, inputVersion: review.inputVersion })).digest('hex');
}

export async function createAnalysisRun(userId: string, request: CreateAnalysisRunInput) {
  const input = CreateAnalysisRunSchema.parse(request);
  const { apiKey: _secret, ...configuration } = llm.config;
  const embedding = defaultEmbeddingConfiguration();
  const grouping = GroupingSettingsSchema.parse(input.grouping ?? {});
  try {
    const run = await prisma.$transaction(async (tx) => {
      // Coordinate creation and deletion through the same product row lock.
      const products = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Product" WHERE id = ${input.productId} AND "userId" = ${userId} FOR UPDATE`;
      if (!products.length) throw new HttpError(404, 'Товар не найден');
      if (await tx.analysisRun.findFirst({ where: { productId: input.productId, status: { in: [...ACTIVE_RUN_STATUSES] } } })) {
        throw new HttpError(409, 'Для товара уже есть активный запуск');
      }
      if (input.selection.kind === 'imports') {
        const count = await tx.uploadBatch.count({ where: { id: { in: input.selection.importIds }, productId: input.productId, userId } });
        if (count !== input.selection.importIds.length) throw new HttpError(404, 'Импорт не найден');
      }
      const where: Prisma.ReviewWhereInput = { productId: input.productId, product: { userId } };
      if (input.mode === 'new_only') where.analyzedAt = null;
      if (input.selection.kind === 'imports') {
        where.OR = [{ uploadBatchId: { in: input.selection.importIds } },
          { importOccurrences: { some: { uploadBatchId: { in: input.selection.importIds } } } }];
      }
      if (input.period) where.reviewDate = { gte: new Date(input.period.from), lt: new Date(input.period.to) };
      const reviews = await tx.review.findMany({ where, take: input.limit,
        orderBy: [{ importedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, text: true, rating: true, reviewDate: true, importedAt: true, source: true,
          externalId: true, authorExternalId: true, uploadBatchId: true, inputVersion: true },
      });
      const created = await tx.analysisRun.create({ data: {
        userId, productId: input.productId, scope: input as Prisma.InputJsonObject,
        settings: { ...configuration, prompt: EXTRACTION_PROMPT, grouping, embedding },
        provider: configuration.provider, model: configuration.model, modelVersion: 'unverified',
        promptVersion: EXTRACTION_PROMPT_VERSION, embeddingVersion: embeddingVersion(embedding), methodVersion: EXTRACTION_METHOD_VERSION,
        total: reviews.length,
        events: { create: { toStatus: 'queued', initiator: 'owner', stateVersion: 0 } },
      } });
      for (let offset = 0; offset < reviews.length; offset += 500) {
        const batch = reviews.slice(offset, offset + 500).map((review) => ({
          id: randomUUID(), runId: created.id, reviewId: review.id, sourceReviewId: review.id,
          inputVersion: review.inputVersion, inputHash: inputHash(review), text: review.text,
          rating: review.rating, reviewDate: review.reviewDate, importedAt: review.importedAt,
          source: review.source, externalId: review.externalId,
          authorExternalId: review.authorExternalId, uploadBatchId: review.uploadBatchId,
        }));
        await tx.analysisRunReview.createMany({ data: batch });
        await tx.reviewAnalysis.createMany({ data: batch.map((review) => ({
          runId: created.id, runReviewId: review.id, status: 'pending' as const,
        })) });
      }
      return created;
    }, { timeout: 30_000 });
    return publicAnalysisRun(run);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'Для товара уже есть активный запуск');
    }
    throw error;
  }
}

export async function getAnalysisRun(runId: string, userId: string) {
  const run = await prisma.analysisRun.findFirst({ where: { id: runId, userId, product: { userId } } });
  if (!run) throw new HttpError(404, 'Запуск не найден');
  return publicAnalysisRun(run);
}

export async function listAnalysisInputs(runId: string, userId: string, query: ListAnalysisInputsInput) {
  const run = await getAnalysisRun(runId, userId);
  const where: Prisma.AnalysisRunReviewWhereInput = { runId, run: { userId, product: { userId } } };
  const [items, total] = await Promise.all([
    prisma.analysisRunReview.findMany({ where, orderBy: { id: 'asc' },
      skip: (query.page - 1) * query.pageSize, take: query.pageSize,
      select: { id: true, sourceReviewId: true, text: true, rating: true, reviewDate: true, source: true, importedAt: true,
        analysis: { select: { status: true, sentiment: true, errorCode: true,
          aspects: { orderBy: { id: 'asc' }, select: { id: true, name: true, originalName: true, category: true, sentiment: true } },
          issues: { orderBy: [{ quoteStart: 'asc' }, { id: 'asc' }], select: { id: true, aspectId: true,
            scope: true, defect: true, quote: true, quoteStart: true, quoteEnd: true, consequences: true, masking: true } } } } },
    }),
    prisma.analysisRunReview.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize, runStatus: run.status, offsetUnit: 'utf16', offsetEnd: 'exclusive' };
}

/** Retry immutable failed inputs, never the current (possibly edited) review. */
export async function retryFailedAnalysisRun(runId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const source = await tx.analysisRun.findFirst({ where: { id: runId, userId, product: { userId } } });
    if (!source) throw new HttpError(404, 'Запуск не найден');
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${source.productId} AND "userId" = ${userId} FOR UPDATE`;
    if (ACTIVE_RUN_STATUSES.includes(source.status as 'queued' | 'running')) throw new HttpError(409, 'Дождитесь завершения запуска');
    if (await tx.analysisRun.findFirst({ where: { productId: source.productId, status: { in: [...ACTIVE_RUN_STATUSES] } } })) {
      throw new HttpError(409, 'Для товара уже есть активный запуск');
    }
    const inputs = await tx.analysisRunReview.findMany({ where: { runId, analysis: { status: 'failed' } }, orderBy: { id: 'asc' } });
    if (!inputs.length) throw new HttpError(409, 'В запуске нет ошибочных отзывов');
    const created = await tx.analysisRun.create({ data: {
      userId, productId: source.productId, previousRunId: source.id, total: inputs.length,
      scope: { ...(source.scope as Prisma.InputJsonObject), retry: { kind: 'failed_only', sourceRunId: source.id } },
      settings: source.settings as Prisma.InputJsonObject,
      provider: source.provider, model: source.model, modelVersion: source.modelVersion,
      promptVersion: source.promptVersion, embeddingVersion: source.embeddingVersion, methodVersion: source.methodVersion,
      events: { create: { toStatus: 'queued', initiator: 'owner', reason: 'retry_failed', stateVersion: 0 } },
    } });
    for (const input of inputs) {
      const { id: _id, runId: _runId, ...snapshot } = input;
      await tx.analysisRunReview.create({ data: { ...snapshot, runId: created.id,
        analysis: { create: { status: 'pending' } } } });
    }
    return publicAnalysisRun(created);
  }, { timeout: 30_000 });
}

export async function listAnalysisRuns(userId: string, query: ListAnalysisRunsInput) {
  const where: Prisma.AnalysisRunWhereInput = { userId, product: { userId },
    ...(query.productId ? { productId: query.productId } : {}), ...(query.status ? { status: query.status } : {}) };
  const [items, total] = await Promise.all([
    prisma.analysisRun.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize }), prisma.analysisRun.count({ where }),
  ]);
  return { items: items.map(publicAnalysisRun), total, page: query.page, pageSize: query.pageSize };
}

async function lockRun(tx: Prisma.TransactionClient, runId: string): Promise<AnalysisRun | null> {
  const rows = await tx.$queryRaw<AnalysisRun[]>`SELECT * FROM "AnalysisRun" WHERE id = ${runId} FOR UPDATE`;
  return rows[0] ?? null;
}

function ownsLease(run: AnalysisRun | null, token: string): run is AnalysisRun {
  return !!run && run.status === 'running' && run.leaseToken === token
    && !!run.leaseExpiresAt && run.leaseExpiresAt > new Date();
}

export async function claimAnalysisRun(runId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await lockRun(tx, runId);
    if (!current || current.status !== 'queued' || current.cancelRequestedAt) return null;
    const now = new Date(); const leaseToken = randomUUID();
    const diagnostics = current.diagnostics as Prisma.JsonObject | null;
    const claimed = await tx.analysisRun.update({ where: { id: runId }, data: {
      status: 'running', stage: 'extraction', startedAt: now, heartbeatAt: now,
      leaseToken, leaseExpiresAt: new Date(now.getTime() + env.ANALYSIS_LEASE_MS),
      stateVersion: { increment: 1 }, diagnostics: { workerAttempts: Number(diagnostics?.workerAttempts ?? 0) + 1 },
    } });
    await tx.analysisRunEvent.create({ data: { runId, fromStatus: 'queued', toStatus: 'running',
      initiator: 'worker', stateVersion: claimed.stateVersion } });
    return claimed;
  });
}

export async function heartbeatAnalysisRun(runId: string, token: string) {
  return prisma.$transaction(async (tx) => {
    const current = await lockRun(tx, runId);
    if (!ownsLease(current, token)) return null;
    const now = new Date();
    return tx.analysisRun.update({ where: { id: runId }, data: {
      heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + env.ANALYSIS_LEASE_MS),
    } });
  });
}

export async function beginAnalysisInput(runId: string, token: string, inputId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await lockRun(tx, runId);
    if (!ownsLease(current, token) || current.cancelRequestedAt) return false;
    const updated = await tx.reviewAnalysis.updateMany({ where: { runId, runReviewId: inputId, status: 'pending' },
      data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } } });
    return updated.count === 1;
  });
}

export type InputOutcome = { result: AnalysisResult | ExtractionResult; durationMs: number } | { errorCode: string; durationMs: number };
export async function saveAnalysisInput(runId: string, token: string, inputId: string, outcome: InputOutcome) {
  const result = 'result' in outcome ? ('complaints' in outcome.result
    ? ExtractionResultSchema.parse(outcome.result) : AnalysisResultSchema.parse(outcome.result)) : undefined;
  return prisma.$transaction(async (tx) => {
    const current = await lockRun(tx, runId);
    if (!ownsLease(current, token) || current.cancelRequestedAt) return false;
    const analysis = await tx.reviewAnalysis.findUnique({ where: { runReviewId: inputId } });
    if (!analysis || analysis.runId !== runId || analysis.status !== 'running') return false;
    const input = result && 'complaints' in result
      ? await tx.analysisRunReview.findUniqueOrThrow({ where: { id: inputId } }) : null;
    const prepared = input && result && 'complaints' in result ? prepareExtraction(input.text, input.rating, result) : null;
    await tx.reviewAnalysis.update({ where: { id: analysis.id }, data: {
      status: result ? 'succeeded' : 'failed', finishedAt: new Date(), durationMs: outcome.durationMs,
      ...(result ? { sentiment: result.sentiment, sentimentScore: result.sentiment_score,
        errorCode: null, diagnostics: { legacyIssues: 'issues' in result ? result.issues : prepared!.complaints.map((item) => item.description),
          evidencePending: !prepared, ...(prepared?.metadata ?? {}) } }
        : { errorCode: 'errorCode' in outcome ? outcome.errorCode.slice(0, 100) : 'unknown' }),
    } });
    if (result) for (const [index, aspect] of result.aspects.entries()) {
      const created = await tx.aspectMention.create({ data: {
        analysisId: analysis.id, ...(prepared?.aspects[index] ?? { category: 'other', name: aspect.name, sentiment: aspect.sentiment }),
      } });
      if (prepared) {
        for (const complaint of prepared.complaints.filter((item) => item.aspectIndex === index)) {
          await tx.issueMention.create({ data: { runId, analysisId: analysis.id, aspectId: created.id,
            scope: complaint.scope, defect: complaint.description, quote: complaint.quote,
            quoteStart: complaint.quoteStart, quoteEnd: complaint.quoteEnd, consequences: complaint.consequences,
            masking: complaint.masking } });
        }
      }
    }
    // Linearize the result and counter update under the same fenced row lock.
    const counted = await tx.analysisRun.updateMany({ where: { id: runId, status: 'running', leaseToken: token,
      leaseExpiresAt: { gt: new Date() }, cancelRequestedAt: null }, data: {
      ...(result ? { succeeded: { increment: 1 } } : { failed: { increment: 1 } }), stateVersion: { increment: 1 },
    } });
    if (counted.count !== 1) throw new HttpError(409, 'Worker потерял право записи');
    return true;
  });
}

async function publishLegacyResults(tx: Prisma.TransactionClient, run: AnalysisRun) {
  const successful = await tx.reviewAnalysis.findMany({ where: { runId: run.id, status: 'succeeded' },
    include: { input: true, aspects: true } });
  for (const analysis of successful) {
    if (!analysis.input.reviewId) continue;
    const issues = (analysis.diagnostics as Prisma.JsonObject | null)?.legacyIssues as string[] | undefined;
    await tx.review.updateMany({ where: { id: analysis.input.reviewId, productId: run.productId,
      product: { userId: run.userId }, inputVersion: analysis.input.inputVersion, text: analysis.input.text }, data: {
      sentiment: analysis.sentiment, sentimentScore: analysis.sentimentScore, analyzedAt: analysis.finishedAt,
      aspects: analysis.aspects.map((aspect) => ({ name: aspect.name, sentiment: aspect.sentiment })),
      issues: issues ?? [], legacyAnalysis: true,
    } });
  }
}

export async function markGroupingStage(runId: string, token: string) {
  return prisma.$transaction(async tx => {
    const current = await lockRun(tx, runId);
    if (!ownsLease(current, token) || current.cancelRequestedAt) return false;
    await tx.analysisRun.update({ where: { id: runId }, data: { stage: 'grouping', stateVersion: { increment: 1 } } });
    return true;
  });
}

export async function finishAnalysisRun(runId: string, token: string, errorCode?: string, groupingPlan?: GroupingPlan) {
  return prisma.$transaction(async (tx) => {
    const current = await lockRun(tx, runId);
    if (!ownsLease(current, token)) return null;
    const results = await tx.reviewAnalysis.findMany({ where: { runId, status: 'succeeded' }, select: { diagnostics: true } });
    const hasComplaints = results.some((result) => {
      const issues = (result.diagnostics as Prisma.JsonObject | null)?.legacyIssues;
      return Array.isArray(issues) && issues.length > 0;
    });
    const processed = current.succeeded + current.failed;
    const groupingReady = !!groupingPlan && !errorCode && processed === current.total;
    const status = current.cancelRequestedAt ? 'cancelled'
      : errorCode === 'worker_shutdown' ? 'interrupted'
      : current.total === 0 ? 'completed'
      : current.succeeded === 0 ? 'failed'
      : current.failed || errorCode || processed < current.total || (hasComplaints && !groupingReady) ? 'partial' : 'completed';
    const finishReason = status === 'cancelled' ? 'owner_cancelled'
      : current.total === 0 ? 'empty_selection'
      : errorCode ?? (groupingReady ? status === 'completed' ? 'analysis_completed' : 'review_errors'
        : hasComplaints ? 'grouping_pending' : status === 'completed' ? 'extraction_without_complaints' : 'review_errors');
    const publishable = (status === 'completed' || status === 'partial') && !errorCode;
    const publication = publishable && groupingReady && current.succeeded > 0 ? await publishGrouping(tx, current, groupingPlan!) : null;
    if (publishable && (!hasComplaints || groupingReady)) await publishLegacyResults(tx, current);
    await tx.reviewAnalysis.updateMany({ where: { runId, status: 'running' }, data: { status: 'pending' } });
    const changed = await tx.analysisRun.updateMany({ where: { id: runId, status: 'running', leaseToken: token,
      leaseExpiresAt: { gt: new Date() } }, data: {
      status, stage: groupingReady ? 'persistence' : hasComplaints ? 'grouping' : 'persistence', finishReason, finishedAt: new Date(),
      leaseToken: null, leaseExpiresAt: null, stateVersion: { increment: 1 },
      diagnostics: { ...(current.diagnostics as Prisma.JsonObject | null),
        grouping: groupingReady ? 'completed' : hasComplaints ? 'pending' : 'empty',
        publicationId: publication?.id ?? null, errorCode: errorCode ?? null },
    } });
    if (changed.count !== 1) throw new HttpError(409, 'Worker потерял право записи');
    const finished = await tx.analysisRun.findUniqueOrThrow({ where: { id: runId } });
    await tx.analysisRunEvent.create({ data: { runId, fromStatus: 'running', toStatus: status,
      initiator: 'worker', reason: finishReason, stateVersion: finished.stateVersion } });
    return finished;
  }, { timeout: 30_000 });
}

export async function cancelAnalysisRun(runId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await lockRun(tx, runId);
    if (!current || current.userId !== userId) throw new HttpError(404, 'Запуск не найден');
    if (!ACTIVE_RUN_STATUSES.includes(current.status as 'queued' | 'running') || current.cancelRequestedAt) return publicAnalysisRun(current);
    const status = current.status === 'queued' ? 'cancelled' : 'running';
    const updated = await tx.analysisRun.update({ where: { id: runId }, data: {
      status, cancelRequestedAt: new Date(), stateVersion: { increment: 1 },
      ...(status === 'cancelled' ? { finishedAt: new Date(), finishReason: 'owner_cancelled' } : {}),
    } });
    await tx.analysisRunEvent.create({ data: { runId, fromStatus: current.status, toStatus: status,
      initiator: 'owner', reason: 'cancel_requested', stateVersion: updated.stateVersion } });
    return publicAnalysisRun(updated);
  });
}

export async function interruptExpiredRuns() {
  const expired = await prisma.analysisRun.findMany({ where: { status: 'running', leaseExpiresAt: { lte: new Date() } }, select: { id: true } });
  for (const candidate of expired) await prisma.$transaction(async (tx) => {
    const current = await lockRun(tx, candidate.id);
    if (!current || current.status !== 'running' || !current.leaseExpiresAt || current.leaseExpiresAt > new Date()) return;
    const status = current.cancelRequestedAt ? 'cancelled' : 'interrupted';
    const updated = await tx.analysisRun.update({ where: { id: current.id }, data: {
      status, finishedAt: new Date(), finishReason: 'lease_expired', leaseToken: null, leaseExpiresAt: null,
      stateVersion: { increment: 1 },
    } });
    await tx.reviewAnalysis.updateMany({ where: { runId: current.id, status: 'running' }, data: { status: 'pending' } });
    await tx.analysisRunEvent.create({ data: { runId: current.id, fromStatus: 'running', toStatus: status,
      initiator: 'recovery', reason: 'lease_expired', stateVersion: updated.stateVersion } });
  });
}
