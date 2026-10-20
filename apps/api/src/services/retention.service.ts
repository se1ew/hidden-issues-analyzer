import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { REPORTS_DIR } from './reports.service.js';
import { UPLOADS_DIR, containedUpload } from '../lib/upload-storage.js';
const DAY = 86400000;
export const RETENTION = { rawResponseDays: 7, diagnosticsDays: 90, reportFileDays: 30, orphanFileDays: 1 } as const;
export function containedFile(root: string, file: string) {
  const resolved = path.resolve(file);
  return path.dirname(resolved) === path.resolve(root) && /^report-[a-zA-Z0-9-]+\.(?:pdf|docx)(?:\.input\.json)?$/.test(path.basename(resolved));
}
export async function maintainStorage(apply = false, now = new Date()) {
  return prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(8018214)`;
    return maintainLocked(db, apply, now);
  }, { timeout: 30000 });
}
async function maintainLocked(db: Prisma.TransactionClient, apply: boolean, now: Date) {
  const cutoff = new Date(+now - RETENTION.reportFileDays * DAY);
  const reports = await db.report.findMany({ where: { status: 'completed', OR: [{ finishedAt: { lt: cutoff } }, { finishedAt: null, createdAt: { lt: cutoff } }] }, select: { id: true, filePath: true } });
  const referenced = new Set((await db.report.findMany({ select: { filePath: true } })).map(report => path.resolve(report.filePath)));
  const files: string[] = [];
  const uploads: string[] = [];
  for (const name of await fs.readdir(UPLOADS_DIR).catch(() => [] as string[])) {
    const file = path.join(UPLOADS_DIR, name);
    if (!containedUpload(file)) continue;
    const stat = await fs.lstat(file).catch(() => null);
    if (stat?.isFile() && stat.mtimeMs < +now - DAY) uploads.push(file);
  }
  for (const report of reports) if (containedFile(REPORTS_DIR, report.filePath)) files.push(report.filePath);
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  for (const name of await fs.readdir(REPORTS_DIR)) {
    const file = path.join(REPORTS_DIR, name);
    if (!containedFile(REPORTS_DIR, file) || referenced.has(file)) continue;
    const stat = await fs.lstat(file);
    if (stat.isFile() && stat.mtimeMs < +now - RETENTION.orphanFileDays * DAY) files.push(file);
  }
  if (apply) {
    await db.report.updateMany({ where: { id: { in: reports.map(report => report.id) }, status: 'completed' }, data: { status: 'expired' } });
    for (const file of files) { const stat = await fs.lstat(file).catch(() => null); if (stat?.isFile()) await fs.unlink(file); }
    for (const file of uploads) { const stat = await fs.lstat(file).catch(() => null); if (stat?.isFile()) await fs.unlink(file); }
    await db.reviewAnalysis.updateMany({ where: { rawResponse: { not: null }, finishedAt: { lt: new Date(+now - RETENTION.rawResponseDays * DAY) } }, data: { rawResponse: null } });
    // Keep error codes, timestamps, immutable inputs, extraction, quotes, memberships and decisions.
    // evidencePending/legacyIssues, offset units, extraction versions and execution
    // metrics affect interpretation of saved results; only transient detail expires.
    await db.$executeRaw`UPDATE "ReviewAnalysis" SET diagnostics = diagnostics - 'providerError' - 'rawError' - 'trace'
      WHERE "finishedAt" < ${new Date(+now - RETENTION.diagnosticsDays * DAY)} AND diagnostics IS NOT NULL`;
    await db.serviceHeartbeat.deleteMany({ where: { expiresAt: { lt: new Date(+now - DAY) } } });
    await db.extractionCache.deleteMany({ where: { expiresAt: { lt: now } } });
  }
  return { dryRun: !apply, expiredReports: reports.length, files: files.map(file => path.basename(file)), temporaryUploads: uploads.map(file => path.basename(file)), policy: RETENTION };
}
