import { describe, expect, it } from 'vitest';
import { CreateAnalysisRunSchema } from '../schemas/analysis-runs.schema.js';
import { inputHash, publicAnalysisRun } from './analysis-runs.service.js';

describe('analysis selection and immutable identity', () => {
  it('requires a specific product instead of silently selecting every product', () => {
    expect(CreateAnalysisRunSchema.safeParse({}).success).toBe(false);
    expect(CreateAnalysisRunSchema.parse({ productId: 'product' })).toMatchObject({
      mode: 'new_only', limit: 200, selection: { kind: 'all_reviews' },
    });
  });
  it.each([
    { productId: 'p', selection: { kind: 'imports', importIds: [] } },
    { productId: 'p', selection: { kind: 'imports', importIds: ['a', 'a'] } },
    { productId: 'p', period: { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' } },
    { productId: 'p', userId: 'foreign' },
    { productId: 'p', limit: 2001 },
  ])('rejects invalid scope %j', (request) => {
    expect(CreateAnalysisRunSchema.safeParse(request).success).toBe(false);
  });
  it('changes snapshot identity when text, missing rating or input version changes', () => {
    const review = { text: '  Исходный текст  ', rating: null, reviewDate: null, inputVersion: 1 };
    const original = inputHash(review);
    expect(inputHash({ ...review, text: review.text.trim() })).not.toBe(original);
    expect(inputHash({ ...review, rating: 5 })).not.toBe(original);
    expect(inputHash({ ...review, inputVersion: 2 })).not.toBe(original);
  });
  it('does not expose the provider URL, prompt, lease token or private settings', () => {
    const exposed = publicAnalysisRun({ id: 'run', settings: { baseUrl: 'internal', apiKey: 'secret', prompt: 'private' },
      total: 3, succeeded: 1, failed: 1, leaseToken: 'private-lease', userId: 'owner', scope: {},
    } as never);
    expect(exposed).toMatchObject({ processed: 2, remaining: 1 });
    expect(JSON.stringify(exposed)).not.toMatch(/internal|secret|private/);
  });
});
