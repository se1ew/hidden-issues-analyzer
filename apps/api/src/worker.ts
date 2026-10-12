import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { analysisRedisConnection, closeAnalysisQueue, dispatchQueuedAnalysisRuns, getAnalysisQueue } from './lib/analysis-queue.js';
import { disconnectPrisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { processAnalysisRun } from './services/analysis-worker.service.js';
import { interruptExpiredRuns } from './services/analysis-runs.service.js';

async function start() {
  const stopping = new AbortController();
  const concurrency = Math.min(env.ANALYSIS_WORKER_CONCURRENCY, env.LLM_CONCURRENCY);
  await getAnalysisQueue().setGlobalConcurrency(concurrency);
  const worker = new Worker<{ runId: string }>(env.ANALYSIS_QUEUE_NAME,
    (job) => processAnalysisRun(job.data.runId, stopping.signal),
    { connection: analysisRedisConnection(true), concurrency,
      lockDuration: Math.max(1000, env.ANALYSIS_LEASE_MS),
      stalledInterval: Math.max(1000, env.ANALYSIS_HEARTBEAT_MS * 3), maxStalledCount: 1 });
  worker.on('error', () => logger.error('Analysis worker connection unavailable'));
  worker.on('failed', (job) => logger.warn({ runId: job?.data.runId }, 'Worker delivery failed'));
  let dispatching = false;
  const recover = async () => {
    if (dispatching) return;
    dispatching = true;
    try { await interruptExpiredRuns(); await dispatchQueuedAnalysisRuns(); }
    catch { logger.warn('Run dispatch unavailable; queued state remains in PostgreSQL'); }
    finally { dispatching = false; }
  };
  await recover();
  const timer = setInterval(() => void recover(), env.ANALYSIS_DISPATCH_MS);
  timer.unref();
  logger.info({ queue: env.ANALYSIS_QUEUE_NAME, concurrency }, 'Analysis worker ready');
  let closing = false;
  const stop = async () => {
    if (closing) return; closing = true;
    clearInterval(timer); stopping.abort();
    await worker.close(); await closeAnalysisQueue(); await disconnectPrisma();
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
start().catch(() => { logger.error('Worker startup failed'); process.exitCode = 1; });
