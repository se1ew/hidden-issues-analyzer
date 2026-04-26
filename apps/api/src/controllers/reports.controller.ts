import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { HttpError } from '../middleware/error.js';
import * as service from '../services/reports.service.js';

const GenerateSchema = z.object({
  format: z.enum(['pdf', 'docx']),
  title: z.string().trim().min(1).max(200).optional(),
});

export async function list(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new HttpError(401, 'Unauthorized');
  const items = await service.listReports(req.user.sub);
  res.json({ items });
}

export async function generate(req: Request, res: Response): Promise<void> {
  const parsed = GenerateSchema.parse(req.body);
  const result = await service.generateReport(parsed.format, req.user?.sub ?? null, parsed.title);
  res.status(201).json(result);
}

export async function download(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const report = await service.getReport(id);
  if (!report) throw new HttpError(404, 'Report not found');
  if (req.user && report.userId && report.userId !== req.user.sub) {
    throw new HttpError(403, 'Forbidden');
  }
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
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  fs.createReadStream(report.filePath).pipe(res);
}
