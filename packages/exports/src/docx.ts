import {
  AlignmentType, Document, Footer, Header, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import type { Statements } from '@auditos/fs-engine';
import { blocks, cleanText, contactLine, footerParts, letterheadName, titleText, type Block, type ExportMeta } from './model';
import { logoSize } from './png-check';

const table = (b: Block): Table =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: b.head.map((h, i) => new TableCell({ children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: h, bold: true })] })] })),
      }),
      ...b.rows.map(
        (r) =>
          new TableRow({
            children: r.cells.map((c, i) => new TableCell({ children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: c, bold: r.bold === true })] })] })),
          }),
      ),
    ],
  });

/** The letterhead at the top of every page: logo (when it checks out), firm name, address and contact line. */
function letterheadParagraphs(meta: ExportMeta): Paragraph[] {
  const lh = meta.letterhead;
  if (!lh) return [];
  const out: Paragraph[] = [];
  const size = lh.logo ? logoSize(lh.logo) : null;
  if (lh.logo && size) {
    try {
      const scale = Math.min(160 / size.width, 60 / size.height, 1);
      out.push(new Paragraph({
        children: [new ImageRun({ type: lh.logo.type === 'image/png' ? 'png' : 'jpg', data: lh.logo.bytes, transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) } })],
      }));
    } catch {
      // a logo that cannot be placed is left out; the name still shows
    }
  }
  out.push(new Paragraph({ children: [new TextRun({ text: letterheadName(lh), bold: true, size: 26 })] }));
  const address = cleanText(lh.address);
  if (address) out.push(new Paragraph({ children: [new TextRun({ text: address, size: 18 })] }));
  const contact = contactLine(lh);
  if (contact) out.push(new Paragraph({ children: [new TextRun({ text: contact, size: 18 })] }));
  return out;
}

export async function exportDocx(s: Statements, meta: ExportMeta): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ children: [new TextRun({ text: titleText(meta), bold: true, size: 32 })] }),
    new Paragraph({ children: [new TextRun({ text: `Reporting framework: ${s.framework.replace(/_/g, ' ')}`, italics: true })] }),
  ];
  for (const b of blocks(s)) {
    children.push(new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: b.title, bold: true, size: 26 })] }), table(b));
  }
  const doc = new Document({
    creator: 'AuditOS',
    title: meta.draft ? `DRAFT ${titleText(meta)}` : titleText(meta),
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              ...(meta.draft
                ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DRAFT: not approved for issue', bold: true, color: 'C00000', size: 28 })] })]
                : meta.letterhead ? [] : [new Paragraph({ children: [] })]),
              ...letterheadParagraphs(meta),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: (() => {
              const f = footerParts(meta);
              return [
                ...(f.note ? [new Paragraph({ children: [new TextRun({ text: f.note, size: 16 })] })] : []),
                new Paragraph({ children: [new TextRun({ text: f.powered ? `${f.exported} | ${f.powered}` : f.exported, size: 16 })] }),
              ];
            })(),
          }),
        },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
