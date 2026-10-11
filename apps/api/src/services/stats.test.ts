import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { getOverviewStats, getSentimentTimeseries } from './stats.service.js';

beforeEach(() => {
  vi.mocked(prisma.review.count).mockResolvedValueOnce(5).mockResolvedValueOnce(3);
  vi.mocked(prisma.review.aggregate).mockResolvedValue({ _avg: { rating: 4 } } as never);
  vi.mocked(prisma.review.groupBy).mockResolvedValue([
    { sentiment: 'positive', _count: { _all: 2 } },
    { sentiment: 'negative', _count: { _all: 1 } },
  ] as never);
  vi.mocked(prisma.hiddenIssue.count).mockResolvedValue(1);
});

describe('getOverviewStats', () => {
  it.each([[undefined, {}], ['__unassigned__', { productId: null }], ['product-1', { productId: 'product-1' }]])(
    'применяет область %s к запросам статистики', async (productId, where) => {
      const result = await getOverviewStats(productId);
      expect(prisma.review.count).toHaveBeenNthCalledWith(1, { where });
      expect(prisma.review.count).toHaveBeenNthCalledWith(2, { where: { ...where, analyzedAt: { not: null } } });
      expect(prisma.hiddenIssue.count).toHaveBeenCalledWith({ where });
      expect(result).toMatchObject({ total: 5, analyzed: 3, pending: 2, avgRating: 4, issuesCount: 1 });
      expect(result.negativePct).toBeCloseTo(100 / 3);
    },
  );

  it('возвращает пустую статистику без NaN для товара без отзывов', async () => {
    vi.mocked(prisma.review.count).mockReset().mockResolvedValue(0);
    vi.mocked(prisma.review.aggregate).mockResolvedValue({ _avg: { rating: null } } as never);
    vi.mocked(prisma.review.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.hiddenIssue.count).mockResolvedValue(0);
    expect(await getOverviewStats('empty')).toEqual({
      total: 0, analyzed: 0, pending: 0, avgRating: null,
      sentiment: { positive: 0, negative: 0, neutral: 0 }, negativePct: 0, issuesCount: 0,
    });
  });
});

describe('getSentimentTimeseries', () => {
  it('объединяет и сортирует тональности и рейтинг, не интерполируя SQL-параметр', async () => {
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([{ bucket: new Date('2026-01-02'), sentiment: 'negative', count: 2n }])
      .mockResolvedValueOnce([
        { bucket: new Date('2026-01-01'), avg_rating: 4.567 },
        { bucket: new Date('2026-01-02'), avg_rating: 2 },
      ]);
    const productId = "product' OR true --";
    const result = await getSentimentTimeseries('week', 30, productId);
    expect(result.buckets).toEqual([
      { date: '2026-01-01', positive: 0, negative: 0, neutral: 0, avgRating: 4.57 },
      { date: '2026-01-02', positive: 0, negative: 2, neutral: 0, avgRating: 2 },
    ]);
    const calls = vi.mocked(prisma.$queryRawUnsafe).mock.calls;
    for (const [sql, bucket, since, id] of calls) {
      expect(sql).toContain('"productId" = $3');
      expect(sql).not.toContain(productId);
      expect(bucket).toBe('week');
      expect(since).toBeInstanceOf(Date);
      expect(id).toBe(productId);
    }
  });

  it('для непривязанных отзывов использует IS NULL без третьего параметра', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    expect(await getSentimentTimeseries('day', 7, '__unassigned__')).toEqual({ buckets: [] });
    for (const call of vi.mocked(prisma.$queryRawUnsafe).mock.calls) {
      expect(call[0]).toContain('"productId" IS NULL');
      expect(call).toHaveLength(3);
    }
  });
});
