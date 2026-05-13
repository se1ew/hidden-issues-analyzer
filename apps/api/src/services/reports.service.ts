import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import PDFDocument from 'pdfkit';

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { getOverviewStats } from './stats.service.js';
import { listHiddenIssues } from './clustering.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../../reports_output');

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

interface ReportPayload {
  generatedAt: Date;
  stats: Awaited<ReturnType<typeof getOverviewStats>>;
  issues: Awaited<ReturnType<typeof listHiddenIssues>>['items'];
}

async function buildPayload(): Promise<ReportPayload> {
  const [stats, issuesResult] = await Promise.all([getOverviewStats(), listHiddenIssues()]);
  return { generatedAt: new Date(), stats, issues: issuesResult.items };
}

export async function generateReport(
  format: 'pdf' | 'docx',
  userId: string | null,
  title?: string,
): Promise<{ id: string; filePath: string; downloadUrl: string }> {
  const payload = await buildPayload();
  const reportTitle = title?.trim() || 'Отчёт по анализу отзывов';
  const filename = `report-${Date.now()}.${format}`;
  const filePath = path.join(REPORTS_DIR, filename);

  if (format === 'pdf') {
    await renderPdf(filePath, reportTitle, payload);
  } else {
    await renderDocx(filePath, reportTitle, payload);
  }

  const report = await prisma.report.create({
    data: {
      userId,
      title: reportTitle,
      format,
      filePath,
    },
  });

  logger.info({ reportId: report.id, format, filePath }, 'Report generated');
  return { id: report.id, filePath, downloadUrl: `/api/reports/${report.id}/download` };
}

export async function getReport(id: string) {
  return prisma.report.findUnique({ where: { id } });
}

export async function listReports(userId: string) {
  return prisma.report.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

// =================== PDF ===================

async function renderPdf(filePath: string, title: string, payload: ReportPayload): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // pdfkit по умолчанию использует Helvetica без кириллицы. Подгружаем системный шрифт DejaVu/Arial если есть.
    const fontPath = findCyrillicFont();
    if (fontPath) doc.font(fontPath);

    doc.fontSize(20).text(title, { align: 'center' });
    doc.moveDown();
    doc
      .fontSize(10)
      .fillColor('#777')
      .text(`Дата формирования: ${payload.generatedAt.toLocaleString('ru-RU')}`, {
        align: 'center',
      });
    doc.fillColor('#000');
    doc.moveDown();

    // Stats
    doc.fontSize(14).text('Сводная статистика', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    const lines = [
      `Всего отзывов: ${payload.stats.total}`,
      `Проанализировано: ${payload.stats.analyzed} (ожидают: ${payload.stats.pending})`,
      `Средний рейтинг: ${payload.stats.avgRating?.toFixed(2) ?? '—'}`,
      `Доля негативных: ${payload.stats.negativePct.toFixed(1)}%`,
      `Позитивных: ${payload.stats.sentiment.positive}, негативных: ${payload.stats.sentiment.negative}, нейтральных: ${payload.stats.sentiment.neutral}`,
      `Скрытых проблем выявлено: ${payload.stats.issuesCount}`,
    ];
    for (const line of lines) doc.text('• ' + line);

    doc.moveDown();
    doc.fontSize(14).text('Топ скрытых проблем', { underline: true });
    doc.moveDown(0.5);

    if (payload.issues.length === 0) {
      doc.fontSize(11).fillColor('#777').text('Скрытые проблемы пока не выявлены.');
      doc.fillColor('#000');
    } else {
      doc.fontSize(11);
      payload.issues.slice(0, 20).forEach((issue, i) => {
        doc
          .fillColor('#000')
          .text(`${i + 1}. ${issue.title}`, { continued: false })
          .fillColor('#577')
          .fontSize(10)
          .text(
            `   hidden_score=${(issue.hiddenScore * 100).toFixed(1)} | size=${issue.size} | severity=${(
              issue.severity * 100
            ).toFixed(0)}% | visibility=${(issue.visibility * 100).toFixed(2)}%`,
          );
        if (issue.description) {
          doc.fontSize(11).fillColor('#333').text(`   ${issue.description}`);
        }
        doc.fontSize(11).moveDown(0.3);
      });
    }

    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

function findCyrillicFont(): string | null {
  const candidates = [
    'C:\\Windows\\Fonts\\arial.ttf',
    'C:\\Windows\\Fonts\\ARIAL.TTF',
    'C:\\Windows\\Fonts\\segoeui.ttf',
    'C:\\Windows\\Fonts\\tahoma.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/Library/Fonts/Arial.ttf',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// =================== DOCX ===================

async function renderDocx(filePath: string, title: string, payload: ReportPayload): Promise<void> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: title, bold: true, size: 36 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: `Дата формирования: ${payload.generatedAt.toLocaleString('ru-RU')}`,
                italics: true,
                color: '777777',
                size: 20,
              }),
            ],
          }),
          new Paragraph({ text: '' }),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: 'Сводная статистика', bold: true })],
          }),

          ...buildStatsRows(payload.stats),

          new Paragraph({ text: '' }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: 'Топ скрытых проблем', bold: true })],
          }),

          ...(payload.issues.length === 0
            ? [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: 'Скрытые проблемы пока не выявлены.',
                      italics: true,
                      color: '777777',
                    }),
                  ],
                }),
              ]
            : buildIssuesTable(payload.issues)),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await fs.promises.writeFile(filePath, buffer);
}

function buildStatsRows(stats: ReportPayload['stats']): Paragraph[] {
  const rows = [
    `Всего отзывов: ${stats.total}`,
    `Проанализировано: ${stats.analyzed} (ожидают: ${stats.pending})`,
    `Средний рейтинг: ${stats.avgRating?.toFixed(2) ?? '—'}`,
    `Доля негативных: ${stats.negativePct.toFixed(1)}%`,
    `Распределение: pos=${stats.sentiment.positive}, neg=${stats.sentiment.negative}, neu=${stats.sentiment.neutral}`,
    `Скрытых проблем: ${stats.issuesCount}`,
  ];
  return rows.map(
    (text) =>
      new Paragraph({
        children: [new TextRun({ text: '• ' + text })],
      }),
  );
}

function buildIssuesTable(issues: ReportPayload['issues']): Array<Paragraph | Table> {
  const header = new TableRow({
    children: [
      headerCell('#'),
      headerCell('Название'),
      headerCell('Hidden score'),
      headerCell('Размер'),
      headerCell('Серьёзность'),
      headerCell('Видимость'),
    ],
  });
  const rows = issues.slice(0, 20).map((issue, i) =>
    new TableRow({
      children: [
        cell(String(i + 1)),
        cell(issue.title),
        cell((issue.hiddenScore * 100).toFixed(1)),
        cell(String(issue.size)),
        cell((issue.severity * 100).toFixed(0) + '%'),
        cell((issue.visibility * 100).toFixed(2) + '%'),
      ],
    }),
  );
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...rows],
  });
  return [table];
}

function headerCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
  });
}
function cell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ text })] });
}
