import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';
import { analysisRedisConnection } from './analysis-queue.js';
import { logger } from './logger.js';
export const importQueueName = `${env.ANALYSIS_QUEUE_NAME}-imports`;
let queue: Queue<{ batchId: string }> | undefined;
export function getImportQueue() {
  if (!queue) {
    queue = new Queue(importQueueName, { connection: analysisRedisConnection() });
    queue.on('error', () => logger.warn('Import queue unavailable; jobs remain in PostgreSQL'));
  }
  return queue;
}
export async function dispatchQueuedImports() {
  const target = getImportQueue();
  // One active source import across all worker processes: at most three probes.
  await target.setGlobalConcurrency(1);
  const batches = await prisma.uploadBatch.findMany({ where: { source: 'parsing', status: 'pending' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100, select: { id: true } });
  for (const batch of batches) {
    const existing = await target.getJob(batch.id);
    if (existing) {
      if (!['completed', 'failed'].includes(await existing.getState())) continue;
      await existing.remove();
    }
    await target.add('source-import', { batchId: batch.id }, { jobId: batch.id, attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: { count: 100 } });
  }
}
export async function closeImportQueue() { if (queue) { const active = queue; queue = undefined; await active.close(); } }
