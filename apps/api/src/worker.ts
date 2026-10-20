import { processNextReport, recoverReports } from './services/report-worker.js';
import { beatWorker, retireWorker } from './lib/worker-heartbeat.js';
import { LIMITS } from './lib/resource-limits.js';
import { logContext } from './lib/log-context.js';
import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { analysisRedisConnection, closeAnalysisQueue, dispatchQueuedAnalysisRuns, getAnalysisQueue } from './lib/analysis-queue.js';
import { disconnectPrisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { processAnalysisRun } from './services/analysis-worker.service.js';
import { interruptExpiredRuns } from './services/analysis-runs.service.js';
import { processNextParsing } from './services/parsing-worker.service.js';
import { importQueueName, getImportQueue, dispatchQueuedImports, closeImportQueue } from './lib/import-queue.js';

async function start() {
  const stopping = new AbortController();
  await getImportQueue().setGlobalConcurrency(1);
  const importWorker = new Worker<{ batchId: string }>(importQueueName,
    job => logContext.run({ importId: job.data.batchId }, () => processNextParsing(stopping.signal, job.data.batchId)),
    { connection: analysisRedisConnection(true), concurrency: 1, lockDuration: 15000, stalledInterval: 5000 });
  importWorker.on('error', () => logger.warn('Import worker connection unavailable'));
  const concurrency = Math.min(env.ANALYSIS_WORKER_CONCURRENCY, env.LLM_CONCURRENCY);
  await getAnalysisQueue().setGlobalConcurrency(concurrency);
  const worker = new Worker<{ runId: string }>(env.ANALYSIS_QUEUE_NAME,
    (job) => logContext.run({ runId: job.data.runId }, () => processAnalysisRun(job.data.runId, stopping.signal)),
    { connection: analysisRedisConnection(true), concurrency,
      lockDuration: Math.max(1000, env.ANALYSIS_LEASE_MS),
      stalledInterval: Math.max(1000, env.ANALYSIS_HEARTBEAT_MS * 3), maxStalledCount: 1 });
  worker.on('error', () => logger.error('Analysis worker connection unavailable'));
  worker.on('failed', (job) => logger.warn({ runId: job?.data.runId }, 'Worker delivery failed'));
  let recovery: Promise<void> | undefined;
  const recover = () => {
    if (recovery) return recovery;
    recovery = (async () => {
      try { await interruptExpiredRuns(); await dispatchQueuedAnalysisRuns(); await dispatchQueuedImports(); }
      catch { logger.warn('Run dispatch unavailable; queued state remains in PostgreSQL'); }
    })().finally(() => { recovery = undefined; });
    return recovery;
  };
  await beatWorker();
  let reportTask: Promise<void> | undefined;
  const reportTimer = setInterval(() => {
    if (reportTask || stopping.signal.aborted) return;
    reportTask = recoverReports().then(() => processNextReport(stopping.signal)).catch(() => logger.warn('Report worker unavailable; saved snapshots retained')).finally(() => { reportTask = undefined; });
  }, env.ANALYSIS_DISPATCH_MS);
  const healthTimer = setInterval(() => { void beatWorker().catch(() => logger.warn('Worker heartbeat unavailable')); }, 3000);
  reportTimer.unref(); healthTimer.unref();
  await recover();
  const timer = setInterval(() => void recover(), env.ANALYSIS_DISPATCH_MS);
  timer.unref();
  logger.info({ queue: env.ANALYSIS_QUEUE_NAME, concurrency }, 'Analysis worker ready');
  let closing = false;
  const stop = async () => {
    if (closing) return; closing = true;
    clearInterval(timer); clearInterval(reportTimer); clearInterval(healthTimer); stopping.abort();
    const deadline = setTimeout(() => process.exit(1), LIMITS.shutdownMs); deadline.unref();
    await Promise.all([worker.close(), importWorker.close()]); await recovery; await reportTask;
    await retireWorker().catch(() => undefined); await closeImportQueue(); await closeAnalysisQueue(); await disconnectPrisma();
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
start().catch(() => { logger.error('Worker startup failed'); process.exitCode = 1; });
