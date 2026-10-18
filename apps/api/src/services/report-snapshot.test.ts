import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerateReportSchema } from '../schemas/reports.schema.js';
import { captureReport } from './report-snapshot.js';
import { reportBlocks } from './report-content.js';
const mocks = vi.hoisted(() => ({ read: vi.fn(), groups: vi.fn(), product: vi.fn(), transaction: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('./analysis-runs.service.js', () => ({ publicAnalysisRun: (value: unknown) => value }));
vi.mock('./run-data.service.js', async importOriginal => ({ ...await importOriginal<object>(), readRunData: mocks.read }));
const request = () => GenerateReportSchema.parse({ productId: 'p', runId: 'r', period: null, format: 'docx', sections: ['overview', 'analytics', 'aspects', 'problems', 'evidence', 'method'] });
beforeEach(() => {
  vi.clearAllMocks();
  const db = { product: { findFirst: mocks.product }, issueClusterSnapshot: { findMany: mocks.groups } };
  mocks.transaction.mockImplementation(async operation => operation(db));
  mocks.product.mockResolvedValue({ id: 'p', name: 'Тестовый товар', source: 'local' });
  mocks.read.mockResolvedValue({ run: { id: 'r', scope: { mode: 'reanalyze', selection: { kind: 'all_reviews' }, limit: 200 }, status: 'completed',
    model: 'fixture', provider: 'local', modelVersion: 'unverified', methodVersion: 'method-v1', promptVersion: 'prompt-v1', embeddingVersion: 'embed-v1',
    createdAt: new Date('2026-03-01'), finishedAt: new Date('2026-03-01'), limitations: ['Качество не измерено'] },
    scope: { productId: 'p', runId: 'r', period: null }, publication: { id: 'pub' },
    inputs: [{ sourceReviewId: 'rev', rating: 5, text: 'Крышка заедает', reviewDate: null, source: 'csv', analysis: { status: 'succeeded', sentiment: 'positive', aspects: [],
      issues: [{ id: 'i', scope: 'product', quote: 'заедает', quoteStart: 7, quoteEnd: 14, consequences: null }] } }],
    overview: { loadedTotal: 2, scopeTotal: 1, succeededCount: 1, failedCount: 0, remainingCount: 0, problemCount: 55, hiddenProblemCount: 55, avgRating: 5 },
    analytics: { total: 1, succeeded: 1, failed: 0, ratingCount: 1, ratingSum: 5, avgRating: 5, complaintCount: 1, complaintRate: 1, highRatedCount: 1, highRatedComplaintCount: 1, highRatedComplaintRate: 1, aspects: [] } });
  mocks.groups.mockResolvedValue(Array.from({ length: 55 }, (_, index) => ({ id: `g${index}`, title: `Группа ${index}`, category: 'quality', scope: 'product',
    metrics: { prevalence: 1 }, reviewCount: 1, positiveContextCount: 1, problem: { id: `p${index}`, status: 'confirmed', stateVersion: 2 }, members: [{ issueMentionId: 'i' }] })));
});
describe('immutable report capture', () => {
  it('captures every group/evidence/status and uses a consistent transaction', async () => {
    const snapshot = await captureReport('owner', request());
    expect(snapshot.groups).toHaveLength(55); expect(snapshot.groups[54].evidence[0]).toMatchObject({ quote: 'заедает', text: 'Крышка заедает', rating: 5 });
    expect(snapshot.groups[54].problem).toEqual({ id: 'p54', status: 'confirmed', stateVersion: 2 });
    expect(mocks.groups.mock.calls[0][0]).not.toHaveProperty('take');
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', timeout: 30000 });
    const text = reportBlocks(snapshot).map(block => block.text).join('\n');
    expect(text).toContain('Группа 54'); expect(text).toContain('жалобами на товар: 1/1 (100.0%)');
    expect(text).toContain('промпт: prompt-v1'); expect(text).toContain('Качество не измерено');
    expect(text.match(/Цитата:/g)).toHaveLength(55);
    const original = mocks.groups.mock.results[0]; expect(original).toBeDefined();
    const groups = await mocks.groups.mock.results[0].value;
    groups[0].problem.status = 'resolved'; expect(snapshot.groups[0].problem?.status).toBe('confirmed');
  });
  it('keeps mandatory method/scope while omitting unselected sections', async () => {
    const snapshot = await captureReport('owner', { ...request(), sections: ['overview'] });
    const text = reportBlocks(snapshot).map(block => block.text).join('\n');
    expect(text).toContain('Метод и ограничения'); expect(text).toContain('Товар:');
    expect(text).not.toContain('Группа 54'); expect(text).not.toContain('Цитата:');
  });
  it('rejects active runs before creating an artifact', async () => {
    const data = await mocks.read(); mocks.read.mockResolvedValue({ ...data, run: { ...data.run, status: 'running' } });
    await expect(captureReport('owner', request())).rejects.toMatchObject({ status: 409 });
    expect(mocks.groups).not.toHaveBeenCalled();
  });
  it('rejects an omitted period for a run with a saved period', async () => {
    const data = await mocks.read(); data.run.scope.period = { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' };
    await expect(captureReport('owner', request())).rejects.toMatchObject({ status: 409, code: 'scope_mismatch' });
  });
  it('requires explicit product, run, period and unique sections', () => {
    expect(GenerateReportSchema.safeParse({ format: 'pdf' }).success).toBe(false);
    expect(GenerateReportSchema.safeParse({ ...request(), sections: ['overview', 'overview'] }).success).toBe(false);
    expect(GenerateReportSchema.safeParse({ ...request(), period: undefined }).success).toBe(false);
  });
});
