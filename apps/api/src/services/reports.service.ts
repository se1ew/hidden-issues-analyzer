import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, HeadingLevel, Packer, Paragraph } from 'docx';
import PDFDocument from 'pdfkit';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { GenerateReportInput } from '../schemas/reports.schema.js';
import { captureReport, type ReportSnapshot } from './report-snapshot.js';
import { reportBlocks } from './report-content.js';

const REPORTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../reports_output');
export async function generateReport(request: GenerateReportInput, userId: string) {
  const payload = await captureReport(userId, request);
  const title = request.title ?? `Анализ отзывов ${payload.product.name}`;
  await fs.promises.mkdir(REPORTS_DIR, { recursive: true });
  const filePath = path.join(REPORTS_DIR, `report-${randomUUID()}.${request.format}`);
  try {
    await renderReport(filePath, request.format, title, payload);
    const bytes = await fs.promises.readFile(filePath);
    const report = await prisma.report.create({ data: { userId, title, format: request.format, filePath,
      productId: request.productId, runId: request.runId, legacy: false, artifactKey: path.basename(filePath),
      mimeType: request.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      parameters: { request, snapshot: payload } as unknown as Prisma.InputJsonObject,
      sizeBytes: BigInt(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') } });
    logger.info({ reportId: report.id, runId: request.runId, format: request.format }, 'Report generated');
    return { id: report.id, downloadUrl: `/api/reports/${report.id}/download` };
  } catch (error) { await fs.promises.rm(filePath, { force: true }); throw error; }
}
function accessibleReports(userId: string) {
  return { userId, OR: [{ product: { userId } }, { legacy: true, parameters: { path: ['ownerScope'], equals: userId } }] };
}
export async function getReport(id: string, userId: string) {
  return prisma.report.findFirst({ where: { id, ...accessibleReports(userId) } });
}
export async function listReports(userId: string) {
  return prisma.report.findMany({ where: accessibleReports(userId),
    select: { id: true, title: true, format: true, createdAt: true, legacy: true, productId: true, runId: true }, orderBy: { createdAt: 'desc' }, take: 50 });
}
export async function renderReport(filePath: string, format: 'pdf' | 'docx', title: string, payload: ReportSnapshot) {
  const blocks = reportBlocks(payload);
  if (format === 'docx') {
    const doc = new Document({ styles: { default: { document: { run: { font: 'Arial', size: 22 }, paragraph: { spacing: { after: 140 } } } } },
      sections: [{ properties: {}, children: [new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
        ...blocks.map(block => new Paragraph({ text: block.text, ...(block.heading ? { heading: HeadingLevel.HEADING_2, keepNext: true } : {}) }))] }] });
    await fs.promises.writeFile(filePath, await Packer.toBuffer(doc)); return;
  }
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve); stream.on('error', reject); doc.on('error', reject); doc.pipe(stream);
    // Bundling a licensed font is the next task in phase 15; retain the existing fallback meanwhile.
    const font = ['C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(candidate => fs.existsSync(candidate));
    if (font) doc.font(font);
    doc.fontSize(19).fillColor('#111111').text(title); doc.moveDown();
    for (const block of blocks) {
      if (block.heading && doc.y > doc.page.height - 130) doc.addPage();
      doc.fontSize(block.heading ? 13 : 10).fillColor('#111111').text(block.text, { paragraphGap: block.heading ? 9 : 5 });
      if (block.heading) doc.moveDown(0.3);
    }
    doc.end();
  });
}
