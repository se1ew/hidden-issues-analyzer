import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, HeadingLevel, Packer, Paragraph, Table, TableRow, TableCell, WidthType, TextRun, TableLayoutType } from 'docx';
import PDFDocument from 'pdfkit';
import type { ReportSnapshot } from './report-snapshot.js';
import { reportBlocks } from './report-content.js';
const fontDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');
export async function renderReport(filePath: string, format: 'pdf' | 'docx', title: string, payload: ReportSnapshot) {
  const blocks = reportBlocks(payload);
  const methodStart = blocks.findIndex(block => block.heading && block.text === "Метод и ограничения");
  if (blocks.reduce((bytes, block) => bytes + Buffer.byteLength(block.text) + Buffer.byteLength(JSON.stringify(block.table ?? '')), 0) > 2 * 1024 * 1024) throw new Error('report_content_limit');
  if (format === 'docx') {
    const doc = new Document({ styles: { default: { document: { run: { font: 'Noto Sans', size: 22 }, paragraph: { spacing: { after: 100 } } } }, paragraphStyles: [{ id: 'Title', name: 'Title', basedOn: 'Normal', run: { color: '111111', font: 'Noto Sans', size: 36 }, paragraph: { keepNext: true, spacing: { after: 260 } } }, { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', run: { color: '111111', bold: true, size: 26 }, paragraph: { keepNext: true, spacing: { before: 180, after: 180 } } }] },
      sections: [{ properties: {}, children: [new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
        ...blocks.map((block, blockIndex) => block.table ? new Table({ layout: TableLayoutType.FIXED, columnWidths: [3744, 1404, 1404, 1404, 1404], width: { size: 9360, type: WidthType.DXA }, rows: [block.table.headers, ...block.table.rows].map((row, index) => new TableRow({ tableHeader: index === 0, cantSplit: true, children: row.map((text, column) => new TableCell({ width: { size: column === 0 ? 3744 : 1404, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text, bold: index === 0 })] })] })) })) }) : new Paragraph({ text: block.text, ...(methodStart >= 0 && blockIndex >= methodStart && blockIndex < blocks.length - 1 ? { keepNext: true } : {}), ...(block.heading ? { heading: HeadingLevel.HEADING_2, keepNext: true } : {}) }))] }] });
    await fs.promises.writeFile(filePath, await Packer.toBuffer(doc)); return;
  }
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve); stream.on('error', reject); doc.on('error', reject); doc.pipe(stream);
    doc.registerFont('regular', path.join(fontDir, 'NotoSans-Regular.ttf'));
    doc.registerFont('bold', path.join(fontDir, 'NotoSans-Bold.ttf'));
    doc.font('regular');
    doc.fontSize(19).fillColor('#111111').text(title); doc.moveDown();
    for (const block of blocks) {
      if (block.table) {
        const left = 50, widths = [198, 74, 74, 74, 75];
        const draw = (values: string[], header: boolean) => {
          doc.font(header ? 'bold' : 'regular').fontSize(9);
          const height = Math.max(24, ...values.map((text, index) => doc.heightOfString(text, { width: widths[index] - 12 }) + 12));
          const top = doc.y; let x = left;
          values.forEach((text, index) => { doc.rect(x, top, widths[index], height).stroke('#cccccc'); doc.fillColor('#111111').text(text, x + 6, top + 6, { width: widths[index] - 12 }); x += widths[index]; });
          doc.x = left; doc.y = top + height;
        };
        draw(block.table.headers, true);
        for (const row of block.table.rows) {
          doc.font('regular').fontSize(9);
          const height = Math.max(24, ...row.map((text, index) => doc.heightOfString(text, { width: widths[index] - 12 }) + 12));
          if (doc.y + height > doc.page.height - 50) { doc.addPage(); draw(block.table.headers, true); }
          draw(row, false);
        }
        doc.moveDown(); continue;
      }
      if (block.heading && doc.y > doc.page.height - 130) doc.addPage();
      doc.font(block.heading ? 'bold' : 'regular').fontSize(block.heading ? 13 : 10).fillColor('#111111').text(block.text, { paragraphGap: block.heading ? 9 : 5 });
      if (block.heading) doc.moveDown(0.3);
    }
    doc.end();
  });
}
