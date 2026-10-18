import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupEvidence, listRunGroups } from './grouping-management.service.js';
import { GroupingQuerySchema } from '../schemas/grouping.schema.js';
const mocks = vi.hoisted(() => ({ product: vi.fn(), run: vi.fn(), publication: vi.fn(), snapshot: vi.fn(), mentions: vi.fn(), count: vi.fn(), snapshots: vi.fn(), problems: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { product: { findFirst: mocks.product }, analysisRun: { findFirst: mocks.run },
  groupingPublication: { findFirst: mocks.publication }, issueClusterSnapshot: { findFirst: mocks.snapshot, findMany: mocks.snapshots },
  problem: { findMany: mocks.problems }, issueMention: { findMany: mocks.mentions, count: mocks.count } } }));
beforeEach(() => { vi.clearAllMocks(); mocks.product.mockResolvedValue(null); mocks.snapshot.mockResolvedValue(null); });
describe('grouping evidence read boundaries', () => {
  it('applies the positive-context union to both the full count and paginated evidence', async () => {
    mocks.snapshot.mockResolvedValue({ id: 's', runId: 'r' }); mocks.mentions.mockResolvedValue([]); mocks.count.mockResolvedValue(17);
    const data = await groupEvidence('owner', 's', 2, 10, 'positive_context');
    expect(data).toMatchObject({ total: 17, page: 2, context: 'positive_context' });
    const where = { clusters: { some: { clusterId: 's' } }, runId: 'r', analysis: { OR: [{ input: { rating: { gte: 4 } } }, { sentiment: 'positive' }] } };
    expect(mocks.count).toHaveBeenCalledWith({ where });
    expect(mocks.mentions).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 10, take: 10 }));
  });
  it('filters before taking pages and counts the complete matching selection', async () => {
    mocks.product.mockResolvedValue({ id: 'p', publishedGroupingId: 'pub' });
    mocks.publication.mockResolvedValue({ id: 'pub', runId: 'r', run: { scope: {} } });
    mocks.snapshots.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: `s${String(i).padStart(2, '0')}`, category: 'quality', reviewCount: i + 1,
      positiveContextCount: 0, metrics: { priority: { score: (i + 1) * 100000 } }, members: [], problem: { status: 'new' } })));
    mocks.mentions.mockResolvedValue([]); mocks.problems.mockResolvedValue([]);
    const result = await listRunGroups('owner', GroupingQuerySchema.parse({ productId: 'p', minSupport: 5, page: 2, pageSize: 10 }));
    expect(result.total).toBe(21); expect(result.items).toHaveLength(10); expect(result.items[0].reviewCount).toBe(15);
  });
  it('rejects a foreign product before loading a publication or members', async () => {
    await expect(listRunGroups('owner', GroupingQuerySchema.parse({ productId: 'foreign' }))).rejects.toMatchObject({ status: 404 });
    expect(mocks.product).toHaveBeenCalledWith({ where: { id: 'foreign', userId: 'owner' }, select: { id: true, publishedGroupingId: true } });
    expect(mocks.publication).not.toHaveBeenCalled();
  });
  it('rejects a foreign snapshot before reading review text', async () => {
    await expect(groupEvidence('owner', 'foreign', 1, 10)).rejects.toMatchObject({ status: 404 });
    expect(mocks.snapshot).toHaveBeenCalledWith({ where: { id: 'foreign', publication: { sealedAt: { not: null } }, run: { userId: 'owner', product: { userId: 'owner' } } } });
    expect(mocks.mentions).not.toHaveBeenCalled();
  });
  it('serves only the matching publication and run scope', async () => {
    mocks.product.mockResolvedValue({ id: 'p', publishedGroupingId: 'pub' }); mocks.run.mockResolvedValue({ id: 'run' });
    mocks.publication.mockResolvedValue({ id: 'pub', runId: 'another-run' });
    await expect(listRunGroups('owner', GroupingQuerySchema.parse({ productId: 'p', runId: 'run', publicationId: 'pub' }))).rejects.toMatchObject({ status: 404 });
  });
  it('keeps missing publication distinct from a successful empty grouping', async () => {
    mocks.product.mockResolvedValue({ id: 'p', publishedGroupingId: null }); mocks.publication.mockResolvedValue(null);
    expect(await listRunGroups('owner', GroupingQuerySchema.parse({ productId: 'p' }))).toMatchObject({ publication: null, items: [], total: 0 });
  });
});
