import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { LIMITS } from '../lib/resource-limits.js';
import { REPORTS_DIR } from './reports.service.js';

export async function recoverReports() {
  await prisma.report.updateMany({ where: { status: 'queued', attemptCount: { gte: 3 } }, data: { status: 'failed', errorCode: 'attempts_exhausted', finishedAt: new Date() } });
  const where = { status: 'running' as const, leaseExpiresAt: { lt: new Date() } };
  await prisma.report.updateMany({ where: { ...where, attemptCount: { lt: 3 } }, data: { status: 'queued', leaseExpiresAt: null, errorCode: 'worker_restarted' } });
  await prisma.report.updateMany({ where: { ...where, attemptCount: { gte: 3 } }, data: { status: 'failed', leaseExpiresAt: null, errorCode: 'attempts_exhausted', finishedAt: new Date() } });
}
export async function processNextReport(signal?: AbortSignal) {
  if (signal?.aborted) return;
  const report = await prisma.report.findFirst({ where: { status: 'queued', attemptCount: { lt: 3 } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (!report) return;
  const attemptCount = report.attemptCount + 1;
  const claimed = await prisma.report.updateMany({ where: { id: report.id, status: 'queued', attemptCount: report.attemptCount },
    data: { status: 'running', attemptCount, startedAt: new Date(), leaseExpiresAt: new Date(Date.now() + LIMITS.reportLeaseMs), errorCode: null } });
  if (!claimed.count) return;
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const key = `report-${report.id}-${randomUUID()}.${report.format}`;
  const output = path.join(REPORTS_DIR, key), input = path.join(REPORTS_DIR, `${key}.input.json`);
  const fence = { id: report.id, status: 'running' as const, attemptCount };
  try {
    const snapshot = (report.parameters as { snapshot?: unknown } | null)?.snapshot;
    if (!snapshot) throw new Error('snapshot_missing');
    await fs.writeFile(input, JSON.stringify({ format: report.format, title: report.title, snapshot }), { flag: 'wx' });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [`--max-old-space-size=${LIMITS.reportHeapMb}`, fileURLToPath(new URL('../report-render-child.js', import.meta.url)), input, output],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      let timedOut = false;
      const abort = () => child.kill();
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, LIMITS.reportTimeoutMs);
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      child.on('message', message => logger.info({ reportId: report.id, runId: report.runId, ...(message as { peakRssBytes: number }) }, 'Report renderer resource usage'));
      child.once('error', () => reject(new Error('renderer_unavailable')));
      child.once('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (signal?.aborted) reject(new Error('worker_shutdown'));
        else if (timedOut) reject(new Error('report_timeout'));
        else if (code !== 0) reject(new Error('render_failed'));
        else resolve();
      });
    });
    const bytes = await fs.readFile(output);
    const updated = await prisma.report.updateMany({ where: fence, data: { status: 'completed', finishedAt: new Date(), leaseExpiresAt: null,
      filePath: output, artifactKey: key, sizeBytes: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') } });
    if (!updated.count) await fs.rm(output, { force: true });
    logger.info({ reportId: report.id, runId: report.runId }, 'Report completed');
  } catch (error) {
    await fs.rm(output, { force: true });
    const code = signal?.aborted ? 'worker_shutdown' : error instanceof Error && ['report_timeout', 'snapshot_missing', 'renderer_unavailable'].includes(error.message) ? error.message : 'render_failed';
    await prisma.report.updateMany({ where: fence, data: { status: signal?.aborted ? 'queued' : 'failed', errorCode: code, leaseExpiresAt: null, finishedAt: new Date() } });
    logger.warn({ reportId: report.id, runId: report.runId, code }, 'Report retained for retry');
  } finally { await fs.rm(input, { force: true }); }
}
