import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { scopedOverview } from './stats.service.js';
vi.mock('./current-reviews.js', () => ({ countCurrentAnalyses: vi.fn(async () => 2) }));
describe('current overview without a saved run', () => {
  it('keeps loaded and processed counts separate and never reuses legacy aggregates', async () => {
    vi.mocked(prisma.review.count).mockResolvedValue(5);
    const result = await scopedOverview('owner', {});
    expect(result).toMatchObject({ loadedTotal: 5, unprocessedCount: 3, hasRun: false, problemCount: null, scopeTotal: null });
    expect(prisma.review.count).toHaveBeenCalledWith({ where: { product: { userId: 'owner' } } });
  });
});
