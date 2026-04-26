import { prisma } from '../lib/prisma.js';

export async function getOverviewStats() {
  const [total, analyzed, avgRating, sentimentCounts, issuesCount] = await Promise.all([
    prisma.review.count(),
    prisma.review.count({ where: { analyzedAt: { not: null } } }),
    prisma.review.aggregate({ _avg: { rating: true } }),
    prisma.review.groupBy({
      by: ['sentiment'],
      _count: { _all: true },
      where: { sentiment: { not: null } },
    }),
    prisma.hiddenIssue.count(),
  ]);

  const sentiment = { positive: 0, negative: 0, neutral: 0 };
  for (const row of sentimentCounts) {
    if (row.sentiment) sentiment[row.sentiment] = row._count._all;
  }

  const sentimentTotal = sentiment.positive + sentiment.negative + sentiment.neutral;
  const negativePct = sentimentTotal > 0 ? (sentiment.negative / sentimentTotal) * 100 : 0;

  return {
    total,
    analyzed,
    pending: total - analyzed,
    avgRating: avgRating._avg.rating,
    sentiment,
    negativePct,
    issuesCount,
  };
}

export type Bucket = 'day' | 'week' | 'month';

export async function getSentimentTimeseries(bucket: Bucket = 'day', days = 30) {
  // Группируем по дате (день/неделя/месяц) — используем raw SQL для совместимости
  const trunc =
    bucket === 'month' ? 'month' : bucket === 'week' ? 'week' : 'day';
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRawUnsafe<
    Array<{ bucket: Date; sentiment: string; count: bigint }>
  >(
    `
    SELECT date_trunc($1, COALESCE("reviewDate", "createdAt")) AS bucket,
           sentiment::text AS sentiment,
           COUNT(*) AS count
    FROM "Review"
    WHERE COALESCE("reviewDate", "createdAt") >= $2
      AND sentiment IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1 ASC
    `,
    trunc,
    since,
  );

  // Преобразуем в формат: [{ date, positive, negative, neutral }]
  const map = new Map<
    string,
    { date: string; positive: number; negative: number; neutral: number }
  >();
  for (const r of rows) {
    const key = r.bucket.toISOString().slice(0, 10);
    const entry =
      map.get(key) ?? { date: key, positive: 0, negative: 0, neutral: 0 };
    if (r.sentiment === 'positive') entry.positive = Number(r.count);
    if (r.sentiment === 'negative') entry.negative = Number(r.count);
    if (r.sentiment === 'neutral') entry.neutral = Number(r.count);
    map.set(key, entry);
  }

  return { buckets: Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)) };
}
