import { beforeEach, describe, expect, it, vi } from 'vitest';
import { editGrouping, setProblemState } from './grouping-management.service.js';
import { GroupingSettingsSchema } from '../schemas/grouping.schema.js';

const mocks = vi.hoisted(() => ({ source: vi.fn(), current: vi.fn(), lock: vi.fn(), publish: vi.fn(),
  problemFind: vi.fn(), problemGet: vi.fn(), problemUpdate: vi.fn(), event: vi.fn(), mentions: vi.fn() }));
vi.mock('../lib/prisma.js', () => {
  const tx = { groupingPublication: { findFirst: mocks.source, findUniqueOrThrow: mocks.current }, $queryRaw: mocks.lock,
    problem: { findFirst: mocks.problemFind, findUniqueOrThrow: mocks.problemGet, update: mocks.problemUpdate },
    problemEvent: { create: mocks.event }, issueMention: { findMany: mocks.mentions },
    $transaction: async (operation: (transaction: unknown) => unknown) => operation(tx) };
  return { prisma: tx };
});
vi.mock('./clustering.service.js', async original => ({ ...await original<typeof import('./clustering.service.js')>(), publishGrouping: mocks.publish }));
const mention = (id: string) => ({ id, runId: 'run', defect: 'заедает крышка', scope: 'product', quote: 'заедает крышка', quoteStart: 0, quoteEnd: 14, consequences: null,
  aspect: { name: 'удобство', category: 'usability' }, analysis: { sentiment: 'positive', input: { text: 'заедает крышка', sourceReviewId: id, inputHash: id, rating: 5, importedAt: new Date('2026-10-01') } } });
const source = () => ({ id: 'pub', runId: 'run', productId: 'product', run: { id: 'run', total: 4, succeeded: 4, failed: 0,
  embeddingVersion: 'fixture', settings: { grouping: GroupingSettingsSchema.parse({}) } }, snapshots: [
    { id: 'a', problemId: 'card-a', needsReview: false, members: ['1', '2'].map(id => ({ mention: mention(id) })) },
    { id: 'b', problemId: 'card-b', needsReview: false, members: ['3', '4'].map(id => ({ mention: mention(id) })) },
  ] });
beforeEach(() => {
  vi.clearAllMocks(); mocks.source.mockResolvedValue(source()); mocks.current.mockResolvedValue({ id: 'pub', runId: 'run' });
  mocks.lock.mockResolvedValue([{ publishedGroupingId: 'pub' }]); mocks.publish.mockResolvedValue({ id: 'edited' });
  mocks.problemFind.mockResolvedValue({ id: 'card', productId: 'product' });
  mocks.problemGet.mockResolvedValue({ id: 'card', status: 'new', stateVersion: 2 });
  mocks.problemUpdate.mockResolvedValue({ id: 'card', status: 'resolved', stateVersion: 3 });
  mocks.mentions.mockResolvedValue([{ analysis: { input: { sourceReviewId: 'known' } } }]);
});
const base = { expectedPublicationId: 'pub', reason: 'Проверенные доказательства', commit: false };
describe('owner grouping corrections', () => {
  it('previews without writing and commits a new publication without copying old card states', async () => {
    const input = { ...base, change: { kind: 'merge' as const, snapshotIds: ['a', 'b'] } };
    const preview = await editGrouping('owner', 'pub', input);
    expect(preview.preview).toHaveLength(1); expect(preview.preview[0].metrics.support).toBe(4);
    expect(mocks.publish).not.toHaveBeenCalled();
    await editGrouping('owner', 'pub', { ...input, commit: true });
    expect(mocks.publish).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      groups: [expect.objectContaining({ problemId: null, metrics: expect.objectContaining({ support: 4 }) })],
    }), expect.objectContaining({ actorUserId: 'owner', sourceId: 'pub', action: expect.objectContaining({ kind: 'merge', reason: base.reason }) }));
  });
  it('rejects duplicate or missing split members and retains distinct resulting signals', async () => {
    await expect(editGrouping('owner', 'pub', { ...base, change: { kind: 'split', snapshotId: 'a', parts: [['1'], ['1']] } })).rejects.toMatchObject({ status: 422 });
    await expect(editGrouping('owner', 'pub', { ...base, change: { kind: 'split', snapshotId: 'a', parts: [['1'], ['unknown']] } })).rejects.toMatchObject({ status: 422 });
    const preview = await editGrouping('owner', 'pub', { ...base, change: { kind: 'split', snapshotId: 'a', parts: [['1'], ['2']] } });
    expect(preview.preview.filter(group => group.metrics.signal)).toHaveLength(2);
  });
  it('rejects stale previews, foreign publications and foreign target cards', async () => {
    mocks.lock.mockResolvedValueOnce([{ publishedGroupingId: 'newer' }]);
    await expect(editGrouping('owner', 'pub', { ...base, change: { kind: 'restore' } })).rejects.toMatchObject({ status: 409 });
    mocks.source.mockResolvedValueOnce(null);
    await expect(editGrouping('owner', 'foreign', { ...base, change: { kind: 'restore' } })).rejects.toMatchObject({ status: 404 });
    mocks.problemFind.mockResolvedValueOnce(null);
    await expect(editGrouping('owner', 'pub', { ...base, change: { kind: 'link', snapshotId: 'a', problemId: 'foreign' } })).rejects.toMatchObject({ status: 404 });
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('restores an earlier grouping through a new publication within the same run', async () => {
    mocks.current.mockResolvedValueOnce({ id: 'current', runId: 'run' });
    mocks.lock.mockResolvedValueOnce([{ publishedGroupingId: 'current' }]);
    await editGrouping('owner', 'old', { ...base, expectedPublicationId: 'current', commit: true, change: { kind: 'restore' } });
    expect(mocks.publish).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ action: expect.objectContaining({ kind: 'restore', previousPublicationId: 'current' }) }));
  });
});
describe('versioned owner decisions', () => {
  it('records resolution, version and known evidence in one transaction', async () => {
    await setProblemState('owner', 'card', { status: 'resolved', expectedVersion: 2, reason: 'Исправлено' });
    expect(mocks.problemUpdate).toHaveBeenCalledWith({ where: { id: 'card' }, data: { status: 'resolved', stateVersion: { increment: 1 }, resolvedAt: expect.any(Date) } });
    expect(mocks.event).toHaveBeenCalledWith({ data: expect.objectContaining({ fromStatus: 'new', toStatus: 'resolved', actorUserId: 'owner', stateVersion: 3, evidence: { reviewIds: ['known'] } }) });
  });
  it('rejects stale versions, invalid transitions and rejection without a reason', async () => {
    await expect(setProblemState('owner', 'card', { status: 'confirmed', expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(setProblemState('owner', 'card', { status: 'rejected', expectedVersion: 2 })).rejects.toThrow();
    mocks.problemGet.mockResolvedValueOnce({ id: 'card', status: 'confirmed', stateVersion: 2 });
    await expect(setProblemState('owner', 'card', { status: 'rejected', expectedVersion: 2, reason: 'Причина' })).rejects.toMatchObject({ status: 409 });
    expect(mocks.event).not.toHaveBeenCalled();
  });
});
