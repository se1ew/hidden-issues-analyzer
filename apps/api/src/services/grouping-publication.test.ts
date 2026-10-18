import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisRun, Prisma } from '@prisma/client';
import { publishGrouping, type GroupingPlan } from './clustering.service.js';
import { describeGroup, type GroupingPoint } from './grouping-engine.js';
import { GroupingSettingsSchema } from '../schemas/grouping.schema.js';

const point = (id: string, date: string): GroupingPoint => ({ id, reviewId: id, productId: 'p', runId: 'run', inputHash: id, defect: 'шумит', quote: 'шумит', quoteStart: 0, quoteEnd: 5,
  category: 'functionality', aspect: 'шум', scope: 'product', rating: 5, sentiment: 'positive', importedAt: new Date(date), consequences: null });
const run = { id: 'run', productId: 'p', userId: 'owner', total: 2, succeeded: 2, failed: 0 } as AnalysisRun;
const settings = GroupingSettingsSchema.parse({});
let order: string[];
const mocks = { previous: vi.fn(), problem: vi.fn(), newProblem: vi.fn(), snapshot: vi.fn(), members: vi.fn(), seal: vi.fn(), pointer: vi.fn(),
  eventFind: vi.fn(), eventCreate: vi.fn(), reopen: vi.fn(), snapshotUpdate: vi.fn() };
const tx = { $queryRaw: async () => [{ id: 'p', publishedGroupingId: 'old' }],
  groupingPublication: { create: async () => { order.push('publication'); return { id: 'pub' }; }, update: mocks.seal },
  issueClusterSnapshot: { findMany: mocks.previous, create: mocks.snapshot, update: mocks.snapshotUpdate },
  issueClusterMember: { createMany: mocks.members }, product: { update: mocks.pointer },
  problem: { findFirst: mocks.problem, create: mocks.newProblem, update: mocks.reopen }, problemEvent: { findFirst: mocks.eventFind, create: mocks.eventCreate },
} as unknown as Prisma.TransactionClient;
beforeEach(() => {
  vi.clearAllMocks(); order = [];
  mocks.previous.mockResolvedValue([{ id: 'old-snapshot', problemId: 'stable', scope: 'product', category: 'functionality', members: [{ mention: { defect: 'шумит' } }] }]);
  mocks.problem.mockResolvedValue({ id: 'stable', status: 'resolved', resolvedAt: new Date('2026-10-10'), stateVersion: 1 });
  mocks.eventFind.mockResolvedValue({ evidence: { reviewIds: ['known'] } });
  mocks.reopen.mockResolvedValue({ stateVersion: 2 });
  mocks.snapshot.mockImplementation(async () => { order.push('snapshot'); return { id: 'snapshot' }; });
  mocks.members.mockImplementation(async () => { order.push('members'); return { count: 2 }; });
  mocks.seal.mockImplementation(async () => { order.push('seal'); return {}; });
  mocks.pointer.mockImplementation(async () => { order.push('pointer'); return {}; });
});
const plan = (date: string): GroupingPlan => ({ runId: run.id, coverage: { total: 2, succeeded: 2, failed: 0 }, settings, embeddingVersion: 'fixture',
  groups: [describeGroup([point('known', '2026-10-01'), point('fresh', date)], { total: 2, succeeded: 2, failed: 0 }, settings)] });
describe('atomic immutable publication and stable decisions', () => {
  it('saves memberships, seals the publication and changes the pointer last', async () => {
    await publishGrouping(tx, run, plan('2026-10-01'));
    expect(order).toEqual(['publication', 'snapshot', 'members', 'seal', 'pointer']);
    expect(mocks.snapshot).toHaveBeenCalledWith({ data: expect.objectContaining({ problemId: 'stable', metrics: expect.objectContaining({ support: 2 }) }) });
    expect(mocks.newProblem).not.toHaveBeenCalled(); expect(mocks.reopen).not.toHaveBeenCalled();
  });
  it('reopens a resolved card only for newly imported evidence after the resolution', async () => {
    await publishGrouping(tx, run, plan('2026-10-11'));
    expect(mocks.reopen).toHaveBeenCalledWith({ where: { id: 'stable' }, data: { status: 'new', resolvedAt: null, stateVersion: { increment: 1 } } });
    expect(mocks.eventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ reason: 'new_evidence_after_resolution', evidence: expect.objectContaining({ reviewId: 'fresh', mentionId: 'fresh', runId: 'run' }) }) });
  });
  it('preserves rejected cards and marks ambiguous matches for owner confirmation', async () => {
    mocks.problem.mockResolvedValueOnce({ id: 'stable', status: 'rejected' });
    await publishGrouping(tx, run, plan('2026-10-11')); expect(mocks.reopen).not.toHaveBeenCalled();
    mocks.previous.mockResolvedValueOnce(['one', 'two'].map(problemId => ({ id: problemId, problemId, scope: 'product', category: 'functionality', members: [{ mention: { defect: 'шумит' } }] })));
    await publishGrouping(tx, run, plan('2026-10-11'));
    expect(mocks.snapshot).toHaveBeenLastCalledWith({ data: expect.objectContaining({ problemId: undefined, needsReview: true,
      metrics: expect.objectContaining({ candidateProblemIds: ['one', 'two'] }) }) });
    expect(mocks.newProblem).not.toHaveBeenCalled();
  });
  it('rejects a mismatched run or coverage before any write', async () => {
    await expect(publishGrouping(tx, run, { ...plan('2026-10-11'), runId: 'foreign' })).rejects.toMatchObject({ status: 409 });
    expect(order).toEqual([]);
  });
});
