import PDFDocument from 'pdfkit';
import type { Statements } from '@auditos/fs-engine';
import { blocks, cleanText, contactLine, footerParts, letterheadName, titleText, type ExportMeta } from './model';
import { logoSize } from './png-check';

const LEFT = 56;
const RIGHT = 556;
const LOGO_MAX_W = 160;
const LOGO_MAX_H = 60;
const FALLBACK_PRIMARY = '#1f3a5f';

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
      const cursorY = doc.y; // drawing the footer must not move where the content continues
      if (meta.draft) {
        doc.save();
        doc.rotate(-35, { origin: [300, 420] }).fontSize(110).fillColor('#e8b4b4').opacity(0.35).text('DRAFT', 90, 360, { lineBreak: false });
        doc.restore();
      }
      const foot = footerParts(meta);
      // Without a letterhead the footer is drawn exactly as before (in whatever font is current).
      if (meta.letterhead) doc.font('Helvetica');
      doc.fontSize(8).fillColor('#666666').opacity(1);
      const cut = (t: string, max: number): string => {
        if (doc.widthOfString(t) <= max) return t;
        let r = t;
        while (r.length > 1 && doc.widthOfString(`${r}...`) > max) r = r.slice(0, -1);
        return `${r}...`;
      };
      // One line each, cut by width, so a long note or e-mail address can never run off the page or over Powered by AuditOS.
      if (foot.note) doc.text(cut(foot.note, RIGHT - LEFT), LEFT, 788, { lineBreak: false });
      if (foot.powered) {
        const pw = doc.widthOfString(foot.powered);
        doc.text(cut(foot.exported, RIGHT - LEFT - pw - 12), LEFT, 800, { lineBreak: false });
        // No width here: text with a width is wrapped, and this line sits below the bottom margin on purpose.
        doc.text(foot.powered, RIGHT - pw, 800, { lineBreak: false });
      } else doc.text(foot.exported, LEFT, 800, { lineBreak: false });
      doc.fillColor('#000000');
      doc.y = cursorY;
    };
    decorate();
    doc.on('pageAdded', decorate);

    let top = 56;
    const lh = meta.letterhead;
    if (lh) {
      const primary = /^#[0-9a-fA-F]{6}$/.test(lh.primary) ? lh.primary : FALLBACK_PRIMARY;
      // A logo is used only if it is checked first: a damaged one would crash the PDF software in a background callback.
      const size = lh.logo ? logoSize(lh.logo) : null;
      let drawn = false;
      if (lh.logo && size) {
        try {
          const scale = Math.min(LOGO_MAX_W / size.width, LOGO_MAX_H / size.height, 1);
          doc.image(lh.logo.bytes, LEFT, top, { width: size.width * scale, height: size.height * scale });
          top += size.height * scale + 6;
          drawn = true;
        } catch {
          drawn = false;
        }
      }
      doc.font('Helvetica-Bold').fontSize(drawn ? 12 : 15).fillColor(drawn ? '#000000' : primary).text(letterheadName(lh), LEFT, top, { width: RIGHT - LEFT });
      doc.fillColor('#000000').font('Helvetica').fontSize(9);
      const address = cleanText(lh.address);
      if (address) doc.text(address, LEFT, undefined, { width: RIGHT - LEFT });
      const contact = contactLine(lh);
      if (contact) doc.text(contact, LEFT, undefined, { width: RIGHT - LEFT });
      doc.moveDown(0.4);
      const ruleY = doc.y;
      doc.save().moveTo(LEFT, ruleY).lineTo(RIGHT, ruleY).lineWidth(1.5).strokeColor(primary).stroke().restore();
      doc.fillColor('#000000');
      top = ruleY + 12;
    }

    doc.fontSize(15).font('Helvetica-Bold').text(titleText(meta), LEFT, top, { width: RIGHT - LEFT });
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
