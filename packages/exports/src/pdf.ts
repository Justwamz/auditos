import PDFDocument from 'pdfkit';
import type { Statements } from '@auditos/fs-engine';
import { blocks, footerText, titleText, type ExportMeta } from './model';

const LEFT = 56;
const RIGHT = 556;

export function exportPdf(s: Statements, meta: ExportMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 64, left: LEFT, right: 612 - RIGHT },
      compress: false,
      info: {
        Title: meta.draft ? `DRAFT ${titleText(meta)}` : titleText(meta),
        Author: 'AuditOS',
        ...(meta.draft ? { Subject: 'DRAFT, not approved for issue' } : {}),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const decorate = () => {
      if (meta.draft) {
        doc.save();
        doc.rotate(-35, { origin: [300, 420] }).fontSize(110).fillColor('#e8b4b4').opacity(0.35).text('DRAFT', 90, 360, { lineBreak: false });
        doc.restore();
      }
      doc.fontSize(8).fillColor('#666666').opacity(1).text(footerText(meta), LEFT, 800, { lineBreak: false });
      doc.fillColor('#000000');
    };
    decorate();
    doc.on('pageAdded', decorate);

    doc.fontSize(15).font('Helvetica-Bold').text(titleText(meta), LEFT, 56, { width: RIGHT - LEFT });
    doc.fontSize(9).font('Helvetica-Oblique').text(`Reporting framework: ${s.framework.replace(/_/g, ' ')}`).moveDown();

    for (const b of blocks(s)) {
      if (doc.y > 680) doc.addPage();
      doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).text(b.title, LEFT);
      const cols = b.head.length;
      const labelW = cols <= 3 ? 280 : 130;
      const numW = (RIGHT - LEFT - labelW) / Math.max(cols - 1, 1);
      const row = (cells: string[], bold: boolean) => {
        if (doc.y > 760) doc.addPage();
        const y = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
        cells.forEach((c, i) => {
          if (i === 0) doc.text(c, LEFT, y, { width: labelW, lineBreak: false });
          else doc.text(c, LEFT + labelW + (i - 1) * numW, y, { width: numW - 6, align: 'right', lineBreak: false });
        });
        doc.y = y + 13;
      };
      row(b.head, true);
      for (const r of b.rows) row(r.cells, r.bold === true);
    }
    doc.end();
  });
}
