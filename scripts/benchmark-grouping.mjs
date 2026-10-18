import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { clusterMentions } from '../apps/api/src/services/grouping-engine.ts';
import { GroupingSettingsSchema } from '../apps/api/src/schemas/grouping.schema.ts';
const results = [];
for (const count of [25, 200, 1000]) {
  const points = Array.from({ length: count }, (_, index) => ({ id: `m${index}`, reviewId: `r${index}`, productId: 'fixture', runId: 'fixture-run',
    inputHash: `${index}`, defect: 'крышка заедает', quote: 'крышка заедает', quoteStart: 0, quoteEnd: 14,
    category: 'usability', aspect: 'удобство', scope: 'product', rating: 5, sentiment: 'positive', importedAt: new Date(0), consequences: null }));
  const vectors = points.map(() => [1, ...Array(383).fill(0)]);
  const memoryBefore = process.memoryUsage(); const start = performance.now();
  const groups = clusterMentions(points, vectors, { total: count, succeeded: count, failed: 0 }, GroupingSettingsSchema.parse({}));
  const elapsedMs = Math.round(performance.now() - start); const memoryAfter = process.memoryUsage();
  assert.equal(groups.length, 1); assert.equal(groups[0].metrics.support, count);
  results.push({ mentions: count, dimension: 384, elapsedMs, heapDeltaMiB: +((memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024).toFixed(1), rssMiB: +(memoryAfter.rss / 1024 / 1024).toFixed(1) });
}
console.log(JSON.stringify({ kind: 'synthetic-identical-vector-cpu-grouping-only', node: process.version, platform: process.platform, results }, null, 2));
