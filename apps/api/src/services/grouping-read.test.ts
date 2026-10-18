import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupEvidence, listRunGroups } from './grouping-management.service.js';
import { GroupingQuerySchema } from '../schemas/grouping.schema.js';
const mocks = vi.hoisted(() => ({ product: vi.fn(), run: vi.fn(), publication: vi.fn(), snapshot: vi.fn(), mentions: vi.fn(), count: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { product: { findFirst: mocks.product }, analysisRun: { findFirst: mocks.run },
  groupingPublication: { findFirst: mocks.publication }, issueClusterSnapshot: { findFirst: mocks.snapshot }, issueMention: { findMany: mocks.mentions, count: mocks.count } } }));
beforeEach(() => { vi.clearAllMocks(); mocks.product.mockResolvedValue(null); mocks.snapshot.mockResolvedValue(null); });
describe('grouping evidence read boundaries', () => {
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
