import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { embed } from '../lib/embeddings.js';
import { chatCompletion } from '../lib/openrouter.js';
import { recomputeHiddenIssues } from './clustering.service.js';

vi.mock('../lib/embeddings.js', () => ({ embed: vi.fn() }));
vi.mock('../lib/openrouter.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/openrouter.js')>(), chatCompletion: vi.fn(),
}));

describe('recomputeHiddenIssues — текущий production-пайплайн', () => {
  it('при недостатке жалоб очищает только выбранную область', async () => {
    vi.mocked(prisma.review.findMany).mockResolvedValue([]);
    vi.mocked(prisma.hiddenIssue.findMany).mockResolvedValue([{ id: 'old' }] as never);
    expect(await recomputeHiddenIssues('owner', 'product-a')).toEqual({ clustersCreated: 0, reviewsAssigned: 0, noisePoints: 0 });
    expect(prisma.hiddenIssue.deleteMany).toHaveBeenCalledWith({ where: { productId: 'product-a', product: { userId: 'owner' } } });
    expect(embed).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('одинаковые жалобы разных товаров создают отдельные кластеры', async () => {
    vi.mocked(prisma.review.findMany).mockResolvedValue([
      { id: 'a1', productId: 'a', sentimentScore: 0.5, issues: ['крышка заедает'] },
      { id: 'a2', productId: 'a', sentimentScore: 0.5, issues: ['заедает крышка'] },
      { id: 'b1', productId: 'b', sentimentScore: 0.5, issues: ['крышка заедает'] },
      { id: 'b2', productId: 'b', sentimentScore: 0.5, issues: ['заедает крышка'] },
    ] as never);
    vi.mocked(prisma.review.count).mockResolvedValue(10);
    vi.mocked(embed).mockResolvedValue([[1, 0], [1, 0]]);
    vi.mocked(chatCompletion).mockResolvedValue('{"title":"Заедает крышка","description":"Описание","keywords":["крышка"]}');
    vi.mocked(prisma.hiddenIssue.create)
      .mockResolvedValueOnce({ id: 'issue-a' } as never)
      .mockResolvedValueOnce({ id: 'issue-b' } as never);
    expect(await recomputeHiddenIssues('owner')).toEqual({ clustersCreated: 2, reviewsAssigned: 4, noisePoints: 0 });
    expect(prisma.hiddenIssue.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ productId: 'a', size: 2, severity: 0.5, visibility: 0.2, hiddenScore: 0.4 }) });
    expect(prisma.hiddenIssue.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ productId: 'b', size: 2 }) });
    expect(prisma.review.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a1', 'a2'] }, product: { userId: 'owner' } }, data: { hiddenIssueId: 'issue-a' } });
    expect(prisma.review.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['b1', 'b2'] }, product: { userId: 'owner' } }, data: { hiddenIssueId: 'issue-b' } });
  });

  it('считает размер кластера по уникальным отзывам', async () => {
    vi.mocked(prisma.review.findMany).mockResolvedValue([
      { id: 'a1', productId: 'a', sentimentScore: 0.5, issues: ['крышка заедает', 'заедает крышка'] },
      { id: 'a2', productId: 'a', sentimentScore: 0.5, issues: ['крышка заедает'] },
    ] as never);
    vi.mocked(prisma.hiddenIssue.findMany).mockResolvedValue([]);
    vi.mocked(prisma.review.count).mockResolvedValue(10);
    vi.mocked(embed).mockResolvedValue([[1, 0], [1, 0], [1, 0]]);
    vi.mocked(chatCompletion).mockResolvedValue('{"title":"Крышка","description":"Описание","keywords":[]}');
    vi.mocked(prisma.hiddenIssue.create).mockResolvedValue({ id: 'issue-a' } as never);
    const result = await recomputeHiddenIssues('owner', 'a');
    expect(result.reviewsAssigned).toBe(2);
    expect(prisma.hiddenIssue.create).toHaveBeenCalledWith({ data: expect.objectContaining({ size: 2, visibility: 0.2 }) });
  });
});
