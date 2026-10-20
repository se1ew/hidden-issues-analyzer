vi.mock('./current-reviews.js', async original => ({ ...await original<typeof import('./current-reviews.js')>(), countCurrentAnalyses: vi.fn(async () => 3) }));
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisRouter } from '../routes/analysis.routes.js';
import { reviewsRouter } from '../routes/reviews.routes.js';
import { errorHandler } from '../middleware/error.js';
import { signAccessToken } from '../middleware/auth.js';
const mocks = vi.hoisted(() => ({ run: vi.fn(), inputs: vi.fn(), publication: vi.fn(), count: vi.fn(), product: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { product: { findFirst: mocks.product }, review: { count: mocks.count }, analysisRun: { findFirst: mocks.run }, analysisRunReview: { findMany: mocks.inputs }, groupingPublication: { findFirst: mocks.publication } } }));
vi.mock('../lib/analysis-queue.js', () => ({ enqueueAnalysisRun: vi.fn(), notifyAnalysisRun: vi.fn() }));
const app = express(); app.use(express.json()); app.use('/analysis', analysisRouter); app.use('/reviews', reviewsRouter); app.use(errorHandler);
const token = signAccessToken({ sub: 'owner', email: 'owner@test.local' });
const period = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' };
const input = (id: string, rating: number | null, status: string, sentiment: string | null) => ({ id, sourceReviewId: `review-${id}`, text: `текст ${id}`, rating,
  reviewDate: id === 'b' ? null : new Date('2026-10-10'), importedAt: new Date('2026-10-11'), source: 'csv', externalId: id,
  analysis: { status, sentiment, sentimentScore: null, finishedAt: new Date('2026-10-12'),
    aspects: status === 'succeeded' ? [{ category: 'quality', name: 'качество', sentiment: 'negative' }] : [],
    issues: status === 'succeeded' ? [{ id: `issue-${id}`, defect: 'жалоба', quote: 'текст', quoteStart: 0, quoteEnd: 5 }] : [] } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockResolvedValue({ id: 'r', productId: 'p', status: 'partial', scope: { period }, finishedAt: new Date('2026-10-18'), createdAt: new Date('2026-10-12') });
  mocks.inputs.mockResolvedValue([input('a', 5, 'succeeded', 'negative'), input('b', null, 'succeeded', 'positive'), input('c', 1, 'failed', null)]);
  mocks.publication.mockResolvedValue({ id: 'pub', _count: { snapshots: 2 }, snapshots: [{ scope: 'product', metrics: { signal: false, hidden: true }, problem: { status: 'new' } }, { scope: 'delivery', metrics: { signal: true, hidden: false }, problem: null }] });
  mocks.count.mockImplementation(({ where }) => Promise.resolve(7));
  mocks.product.mockResolvedValue({ publishedGrouping: { runId: 'r' } });
});
const get = (path: string, query = {}) => request(app).get(path).auth(token, { type: 'bearer' }).query({ productId: 'p', runId: 'r', ...query });

describe('run-scoped HTTP read contracts', () => {
  it('defaults to the current published run while keeping loaded and processed counts separate', async () => {
    const res = await request(app).get('/analysis/stats').auth(token, { type: 'bearer' }).query({ productId: 'p' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hasRun: true, loadedTotal: 7, scopeTotal: 3, succeededCount: 2, failedCount: 1, remainingCount: 0, scope: { runId: 'r' } });
  });
  it('returns unknown analysis coverage and problem counts if nothing was published', async () => {
    mocks.product.mockResolvedValue({ publishedGrouping: null });
    const res = await request(app).get('/analysis/stats').auth(token, { type: 'bearer' }).query({ productId: 'p' });
    expect(res.body).toMatchObject({ hasRun: false, loadedTotal: 7, scopeTotal: null, coverageRatio: null, problemCount: null, hiddenProblemCount: null });
    expect(mocks.inputs).not.toHaveBeenCalled();
  });
  it('uses immutable inputs and independent denominators for overview', async () => {
    const res = await get('/analysis/stats', period);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, analyzed: 2, failed: 1, pending: 0, loadedTotal: 7, scopeTotal: 3, succeededCount: 2, failedCount: 1, remainingCount: 0, problemCount: 1, hiddenProblemCount: 1, signalCount: 1, avgRating: 3, negativePct: 50,
      sentiment: { positive: 1, negative: 1, neutral: 0 }, issuesCount: 2, scope: { productId: 'p', runId: 'r', period } });
    expect(mocks.run).toHaveBeenCalledWith({ where: { id: 'r', productId: 'p', userId: 'owner', product: { userId: 'owner' } } });
  });
  it('serves aspect counts and review filters from the same snapshot', async () => {
    expect((await get('/analysis/aspects')).body.items).toEqual([{ category: 'quality', name: 'качество', positive: 0, negative: 2, neutral: 0 }]);
    const res = await get('/reviews', { sentiment: 'positive', hasIssues: 'true', pageSize: 1 });
    expect(res.status).toBe(200); expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ id: 'review-b', text: 'текст b', rating: null, issues: ['жалоба'] });
  });
  it('keeps unknown dates separate and never substitutes import time', async () => {
    const res = await get('/analysis/timeseries', { bucket: 'day', days: 30 });
    expect(res.body.unknownDateCount).toBe(1);
    expect(res.body.buckets).toHaveLength(30);
    expect(res.body.buckets.find((row: { date: string }) => row.date === '2026-10-10')).toMatchObject({ positive: 0, negative: 1, neutral: 0, avgRating: 3, ratingCount: 2 });
    expect(res.body.buckets.find((row: { date: string }) => row.date === '2026-10-11')).toMatchObject({ total: 0, avgRating: null, complaintRate: null });
  });
  it('rejects a period mismatch before loading evidence', async () => {
    const res = await get('/analysis/stats', { from: '2026-10-02T00:00:00Z', to: period.to });
    expect(res.status).toBe(409); expect(res.body.code).toBe('scope_mismatch'); expect(mocks.inputs).not.toHaveBeenCalled();
  });
  it('hides foreign run IDs and rejects anonymous reads', async () => {
    mocks.run.mockResolvedValue(null);
    expect((await get('/analysis/stats')).status).toBe(404); expect(mocks.inputs).not.toHaveBeenCalled();
    expect((await request(app).get('/analysis/stats').query({ productId: 'p', runId: 'r' })).status).toBe(401);
  });
  it('rejects unknown filters, invalid page sizes and a run without its product', async () => {
    expect((await get('/reviews', { pageSize: 201 })).status).toBe(422);
    expect((await get('/analysis/stats', { extra: 'invalid' })).status).toBe(422);
    expect((await request(app).get('/analysis/stats').auth(token, { type: 'bearer' }).query({ runId: 'r' })).status).toBe(422);
  });
  it.each(['cancelled', 'failed', 'interrupted', 'completed', 'running'])('returns saved data for %s without claiming publication', async status => {
    mocks.run.mockResolvedValue({ id: 'r', productId: 'p', status, scope: {}, createdAt: new Date('2026-10-12'), finishedAt: null });
    mocks.publication.mockResolvedValue(null);
    const res = await get('/analysis/stats');
    expect(res.status).toBe(200); expect(res.body.publicationId).toBeNull(); expect(res.body.issuesCount).toBe(0);
  });
});
