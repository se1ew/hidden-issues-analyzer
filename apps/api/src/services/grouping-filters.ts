import type { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { GroupingQuerySchema } from '../schemas/grouping.schema.js';

type Candidate = { id: string; category: string; reviewCount: number; positiveContextCount: number;
  metrics: Prisma.JsonValue | null; problem: { status: string } | null };
export function filterAndSortGroups<T extends Candidate>(items: T[], query: z.infer<typeof GroupingQuerySchema>): T[] {
  const metric = (item: T) => (item.metrics ?? {}) as Prisma.JsonObject;
  const masking = (item: T) => item.reviewCount ? item.positiveContextCount / item.reviewCount : 0;
  const priority = (item: T) => {
    const saved = metric(item).priority as Prisma.JsonObject | undefined;
    // Old snapshots have no versioned priority; do not manufacture one on read.
    return typeof saved?.score === 'number' ? saved.score : -1;
  };
  const filtered = items.filter(item => (!query.category || item.category === query.category)
    && (!query.status || (query.status === 'signal' ? metric(item).signal === true : item.problem?.status === query.status))
    && (query.minSupport === undefined || item.reviewCount >= query.minSupport)
    && (query.minMasking === undefined || masking(item) >= query.minMasking)
    && (query.minPriority === undefined || priority(item) >= query.minPriority));
  return filtered.sort((a, b) => {
    const diff = query.sort === 'aspect' ? a.category.localeCompare(b.category)
      : query.sort === 'state' ? (a.problem?.status ?? '').localeCompare(b.problem?.status ?? '')
        : query.sort === 'masking' ? masking(a) - masking(b)
          : query.sort === 'support' ? a.reviewCount - b.reviewCount : priority(a) - priority(b);
    return (query.direction === 'asc' ? diff : -diff) || a.id.localeCompare(b.id);
  });
}
