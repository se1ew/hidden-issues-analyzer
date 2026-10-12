import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type AnalysisRun } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { llm } from '../lib/llm.js';
import { HttpError } from '../middleware/error.js';
import { ANALYSIS_PROMPT, ANALYSIS_PROMPT_VERSION } from './analyzer.service.js';
import { CreateAnalysisRunSchema, type CreateAnalysisRunInput, type ListAnalysisRunsInput } from '../schemas/analysis-runs.schema.js';

export const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const;

export function publicAnalysisRun(run: AnalysisRun) {
  const settings = run.settings as Prisma.JsonObject;
  return { id: run.id, runId: run.id, productId: run.productId, status: run.status, stage: run.stage,
    scope: run.scope, provider: run.provider, model: run.model, modelVersion: run.modelVersion,
    promptVersion: run.promptVersion, total: run.total, succeeded: run.succeeded, failed: run.failed,
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
        settings: { ...configuration, prompt: ANALYSIS_PROMPT },
        provider: configuration.provider, model: configuration.model, modelVersion: 'unverified',
        promptVersion: ANALYSIS_PROMPT_VERSION, embeddingVersion: 'not-applied', methodVersion: 'extraction-v1',
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

export async function listAnalysisRuns(userId: string, query: ListAnalysisRunsInput) {
  const where: Prisma.AnalysisRunWhereInput = { userId, product: { userId },
    ...(query.productId ? { productId: query.productId } : {}), ...(query.status ? { status: query.status } : {}) };
  const [items, total] = await Promise.all([
    prisma.analysisRun.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize }), prisma.analysisRun.count({ where }),
  ]);
  return { items: items.map(publicAnalysisRun), total, page: query.page, pageSize: query.pageSize };
}
