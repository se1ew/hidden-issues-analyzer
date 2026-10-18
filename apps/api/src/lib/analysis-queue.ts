import { Queue, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

export const RUN_UPDATES_CHANNEL = `${env.ANALYSIS_QUEUE_NAME}-updates`;
export function analysisRedisConnection(worker = false): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379),
    username: decodeURIComponent(url.username) || undefined, password: decodeURIComponent(url.password) || undefined,
    db: Number(url.pathname.slice(1) || 0), ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: worker ? null : 1, connectTimeout: 2000,
    ...(worker ? {} : { commandTimeout: 2000 }),
  };
}
let queue: Queue<{ runId: string }> | undefined;
export function getAnalysisQueue() {
  if (!queue) {
    queue = new Queue<{ runId: string }>(env.ANALYSIS_QUEUE_NAME, { connection: analysisRedisConnection() });
    queue.on('error', () => logger.warn('Analysis queue connection unavailable'));
  }
  return queue;
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Analysis queue unavailable')), 2500);
  });
  try { return await Promise.race([operation, timeout]); } finally { clearTimeout(timer!); }
}

export async function enqueueAnalysisRun(runId: string) {
  await bounded((async () => {
    const target = getAnalysisQueue(); await target.waitUntilReady();
    const previous = await target.getJob(runId);
    if (previous) {
      const state = await previous.getState();
      if (state !== 'failed' && state !== 'completed') return;
      await previous.remove();
    }
    await target.add('analyze-run', { runId }, { jobId: runId, attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: { count: 100 } });
  })());
}

export async function dispatchQueuedAnalysisRuns() {
  // Reapply after Redis data loss, including while the same worker stays alive.
  await getAnalysisQueue().setGlobalConcurrency(Math.min(env.ANALYSIS_WORKER_CONCURRENCY, env.LLM_CONCURRENCY));
  let cursor: string | undefined;
  while (true) {
    const waiting = await prisma.analysisRun.findMany({ where: { status: 'queued', cancelRequestedAt: null },
      orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true } });
    for (const run of waiting) await enqueueAnalysisRun(run.id);
    if (waiting.length < 100) break;
    cursor = waiting.at(-1)!.id;
  }
}

export async function notifyAnalysisRun(runId: string) {
  try {
    await bounded((async () => {
      const client = await getAnalysisQueue().client;
      await client.publish(RUN_UPDATES_CHANNEL, runId);
    })());
  } catch { logger.warn({ runId }, 'Run notification unavailable; state remains in PostgreSQL'); }
}

export async function closeAnalysisQueue() {
  if (queue) { const active = queue; queue = undefined; await active.close(); }
}
