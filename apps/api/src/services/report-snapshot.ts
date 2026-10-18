import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';
import { readRunData, runTimeseries } from './run-data.service.js';
import { publicAnalysisRun } from './analysis-runs.service.js';
import type { GenerateReportInput } from '../schemas/reports.schema.js';

export async function captureReport(userId: string, request: GenerateReportInput) {
  return prisma.$transaction(async db => {
    const data = await readRunData(userId, { productId: request.productId, runId: request.runId, ...(request.period ?? {}) }, db);
    const actualPeriod = (data.run.scope as { period?: { from: string; to: string } }).period ?? null;
    if (!!actualPeriod !== !!request.period) throw new HttpError(409, 'Период отчёта должен совпадать с областью запуска', undefined, 'scope_mismatch');
    if (['queued', 'running'].includes(data.run.status)) throw new HttpError(409, 'Дождитесь завершения запуска, чтобы сохранить отчёт');
    const product = await db.product.findFirst({ where: { id: request.productId, userId }, select: { id: true, name: true, source: true } });
    if (!product) throw new HttpError(404, 'Товар не найден');
    // Read every group of the selected sealed publication, without list pagination.
    const groups = data.publication ? await db.issueClusterSnapshot.findMany({ where: { publicationId: data.publication.id }, orderBy: { id: 'asc' },
      include: { problem: { select: { id: true, status: true, stateVersion: true, resolvedAt: true } }, members: { select: { issueMentionId: true } } } }) : [];
    const mentions = data.inputs.flatMap(input => (input.analysis?.issues ?? []).map(issue => ({ id: issue.id, reviewId: input.sourceReviewId,
      text: input.text, rating: input.rating, reviewDate: input.reviewDate, source: input.source,
      defect: issue.defect, scope: issue.scope, quote: issue.quote, quoteStart: issue.quoteStart, quoteEnd: issue.quoteEnd, consequences: issue.consequences })));
    return JSON.parse(JSON.stringify({ version: 'report-snapshot-v1', generatedAt: new Date(), product, scope: data.scope,
      publicationId: data.publication?.id ?? null, sections: request.sections, run: publicAnalysisRun(data.run), overview: data.overview,
      analytics: data.analytics, calendar: runTimeseries(data, 'day', request.days),
      errors: data.inputs.filter(input => input.analysis?.status === 'failed').map(input => ({ reviewId: input.sourceReviewId, code: input.analysis?.errorCode })),
      groups: groups.map(({ members, severity: _s, visibility: _v, hiddenScore: _h, ...group }) => ({ ...group, evidence: mentions.filter(mention => members.some(member => member.issueMentionId === mention.id)) })) })) as ReportSnapshot;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
// JSON representation is stored with the artifact so later product edits cannot rewrite it.
export interface ReportSnapshot {
  version: string; generatedAt: string; product: { id: string; name: string; source: string | null };
  scope: { productId: string; runId: string; period: { from: string; to: string } | null };
  publicationId: string | null; sections: GenerateReportInput['sections'];
  run: { id: string; provider: string; model: string; modelVersion: string; methodVersion: string; promptVersion: string; embeddingVersion: string; status: string; limitations: string[] };
  overview: { loadedTotal: number; scopeTotal: number; succeededCount: number; failedCount: number; remainingCount: number; problemCount: number | null; hiddenProblemCount: number | null; avgRating: number | null };
  analytics: ReturnType<typeof import('./run-analytics.js').summarizeInputs>;
  calendar: ReturnType<typeof runTimeseries>;
  errors: Array<{ reviewId: string; code: string | null }>;
  groups: Array<{ id: string; title: string; category: string; scope: string; reviewCount: number; positiveContextCount: number; metrics: Prisma.JsonValue;
    problem: { id: string; status: string; stateVersion: number } | null;
    evidence: Array<{ id: string; reviewId: string; text: string; rating: number | null; reviewDate: string | null; source: string; quote: string; quoteStart: number; quoteEnd: number; consequences: string | null }> }>;
}
