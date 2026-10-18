import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisRouter } from '../routes/analysis.routes.js';
import { errorHandler } from '../middleware/error.js';
import { signAccessToken } from '../middleware/auth.js';
import { saveAnalysisInput } from './analysis-runs.service.js';

const mocks = vi.hoisted(() => ({ run: vi.fn(), inputs: vi.fn(), count: vi.fn(), lock: vi.fn(),
  input: vi.fn(), analysis: vi.fn(), update: vi.fn(), aspect: vi.fn(), issue: vi.fn(), counted: vi.fn() }));
vi.mock('../lib/prisma.js', () => {
  const prisma = { analysisRun: { findFirst: mocks.run, updateMany: mocks.counted },
    analysisRunReview: { findMany: mocks.inputs, findUniqueOrThrow: mocks.input, count: mocks.count },
    reviewAnalysis: { findUnique: mocks.analysis, update: mocks.update },
    aspectMention: { create: mocks.aspect }, issueMention: { create: mocks.issue }, $queryRaw: mocks.lock,
    $transaction: async (operation: (tx: unknown) => unknown) => operation(prisma) };
  return { prisma };
});
const app = express(); app.use('/api/analysis', analysisRouter); app.use(errorHandler);
const token = signAccessToken({ sub: 'owner', email: 'owner@test.local' });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockResolvedValue({ id: 'run', status: 'completed', total: 1, succeeded: 1, failed: 0, settings: {} });
  mocks.inputs.mockResolvedValue([]); mocks.count.mockResolvedValue(0);
  mocks.lock.mockResolvedValue([{ id: 'run', status: 'running', leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 60_000), cancelRequestedAt: null }]);
  mocks.analysis.mockResolvedValue({ id: 'analysis', runId: 'run', status: 'running' });
  mocks.input.mockResolvedValue({ text: '😀 Звук отличный, но давит оголовье', rating: 5 });
  mocks.aspect.mockResolvedValue({ id: 'aspect' }); mocks.counted.mockResolvedValue({ count: 1 });
});

describe('persisted analysis evidence', () => {
  it('stores normalized and original aspects, exact UTF-16 ranges and separate masking reasons', async () => {
    const result = { sentiment: 'positive' as const, sentiment_score: 0.5,
      aspects: [{ name: 'Комфорт', sentiment: 'negative' as const }, { name: 'Звук', sentiment: 'positive' as const }],
      complaints: [{ aspectIndex: 0, scope: 'product' as const, description: 'давит оголовье', quote: 'давит оголовье', assertion: 'experienced' as const, consequences: null }] };
    expect(await saveAnalysisInput('run', 'lease', 'input', { result, durationMs: 1 })).toBe(true);
    expect(mocks.aspect).toHaveBeenCalledTimes(2);
    expect(mocks.aspect).toHaveBeenCalledWith({ data: { analysisId: 'analysis', category: 'usability', name: 'удобство', originalName: 'Комфорт', sentiment: 'negative' } });
    expect(mocks.issue).toHaveBeenCalledWith({ data: expect.objectContaining({
      quoteStart: 21, quoteEnd: 35, consequences: null,
      masking: expect.objectContaining({ highRating: true, positiveSentiment: true, reasons: ['high_rating', 'positive_sentiment'] }),
    }) });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ diagnostics: expect.objectContaining({ offsetUnit: 'utf16', evidencePending: false }) }) }));
  });
  it('accepts no aspects or counters from a result with invented evidence', async () => {
    const result = { sentiment: 'negative' as const, sentiment_score: -0.5, aspects: [{ name: 'Звук', sentiment: 'negative' as const }],
      complaints: [{ aspectIndex: 0, scope: 'product' as const, description: 'шум', quote: 'выдуманная цитата', assertion: 'experienced' as const, consequences: null }] };
    await expect(saveAnalysisInput('run', 'lease', 'input', { result, durationMs: 1 })).rejects.toMatchObject({ code: 'invalid_evidence' });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.issue).not.toHaveBeenCalled(); expect(mocks.counted).not.toHaveBeenCalled();
  });
  it('requires authentication and hides foreign run evidence before querying any input', async () => {
    await request(app).get('/api/analysis/runs/run/inputs').expect(401);
    mocks.run.mockResolvedValue(null);
    await request(app).get('/api/analysis/runs/foreign/inputs').auth(token, { type: 'bearer' }).expect(404);
    expect(mocks.inputs).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledWith({ where: { id: 'foreign', userId: 'owner', product: { userId: 'owner' } } });
  });
  it('bounds pagination and returns the original-text coordinate contract', async () => {
    await request(app).get('/api/analysis/runs/run/inputs?pageSize=51').auth(token, { type: 'bearer' }).expect(422);
    const result = await request(app).get('/api/analysis/runs/run/inputs?page=2&pageSize=10').auth(token, { type: 'bearer' }).expect(200);
    expect(result.body).toMatchObject({ offsetUnit: 'utf16', offsetEnd: 'exclusive', page: 2 });
    expect(mocks.inputs).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, where: { runId: 'run', run: { userId: 'owner', product: { userId: 'owner' } } } }));
  });
});
