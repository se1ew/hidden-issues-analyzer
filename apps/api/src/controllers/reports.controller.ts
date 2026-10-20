import { requestUserId } from '../middleware/auth.js';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { GenerateReportSchema } from '../schemas/reports.schema.js';

import { HttpError } from '../middleware/error.js';
import * as service from '../services/reports.service.js';

export async function list(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new HttpError(401, 'Unauthorized');
  const items = await service.listReports(req.user.sub);
  res.json({ items });
}

export async function generate(req: Request, res: Response): Promise<void> {
  const parsed = GenerateReportSchema.parse(req.body);
  const result = await service.generateReport(parsed, requestUserId(req));
  res.status(202).json(result);
}

export async function download(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const report = await service.getReport(id, requestUserId(req));
  if (!report) throw new HttpError(404, 'Report not found');
  if (report.status === 'expired') throw new HttpError(410, 'Срок хранения файла истёк. Создайте новый отчёт.', undefined, 'report_expired');
  if (report.status !== 'completed') throw new HttpError(409, 'Отчёт ещё не готов. Проверьте статус в истории.', undefined, 'report_not_ready');
  if (!fs.existsSync(report.filePath)) {
    throw new HttpError(410, 'Report file is missing');
  }

  const ext = path.extname(report.filePath);
  const downloadName = `${report.title.replace(/[^\p{L}\p{N}_-]+/gu, '_')}${ext}`;

  res.setHeader(
    'Content-Type',
    report.format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  res.download(report.filePath, downloadName);
}

export async function retry(req: Request, res: Response): Promise<void> {
  res.status(202).json(await service.retryReport(req.params.id as string, requestUserId(req)));
}
