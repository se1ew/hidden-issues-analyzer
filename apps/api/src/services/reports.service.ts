import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { GenerateReportInput } from '../schemas/reports.schema.js';
import { captureReport } from './report-snapshot.js';
import { HttpError } from '../middleware/error.js';

export const REPORTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../reports_output');
export async function generateReport(request: GenerateReportInput, userId: string) {
  const payload = await captureReport(userId, request);
  const title = request.title ?? `Анализ отзывов ${payload.product.name}`;
  await fs.promises.mkdir(REPORTS_DIR, { recursive: true });
  const filePath = path.join(REPORTS_DIR, `report-${randomUUID()}.${request.format}`);
  const report = await prisma.$transaction(async tx => {
    const products = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Product" WHERE id = ${request.productId} AND "userId" = ${userId} FOR UPDATE`;
    if (!products.length) throw new HttpError(404, 'Товар не найден');
    return tx.report.create({ data: { userId, title, format: request.format, filePath,
    productId: request.productId, runId: request.runId, legacy: false, status: 'queued', artifactKey: path.basename(filePath),
    mimeType: request.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    parameters: { request, snapshot: payload } as unknown as Prisma.InputJsonObject } });
  });
  logger.info({ reportId: report.id, runId: request.runId }, 'Report queued');
  return { id: report.id, status: report.status };
}

function accessibleReports(userId: string) {
  return { userId, OR: [{ product: { userId } }, { legacy: true, parameters: { path: ['ownerScope'], equals: userId } }] };
}
export async function getReport(id: string, userId: string) {
  return prisma.report.findFirst({ where: { id, ...accessibleReports(userId) } });
}
export async function listReports(userId: string) {
  return prisma.report.findMany({ where: accessibleReports(userId),
    select: { id: true, title: true, format: true, createdAt: true, legacy: true, productId: true, runId: true, status: true, errorCode: true, attemptCount: true }, orderBy: { createdAt: 'desc' }, take: 50 });
}

export async function retryReport(id: string, userId: string) {
  const report = await getReport(id, userId);
  if (!report) throw new HttpError(404, 'Отчёт не найден');
  if (!['failed', 'expired'].includes(report.status)) throw new HttpError(409, 'Повтор доступен для ошибочного отчёта');
  if (report.status !== 'expired' && report.attemptCount >= 3) throw new HttpError(409, 'Достигнут лимит повторов. Создайте новый отчёт после проверки диагностики.');
  await prisma.report.updateMany({ where: { id, status: report.status, attemptCount: report.attemptCount }, data: { status: 'queued', errorCode: null, leaseExpiresAt: null, ...(report.status === 'expired' ? { attemptCount: 0 } : {}) } });
  return { id, status: 'queued' };
}
