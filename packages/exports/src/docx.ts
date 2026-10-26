import {
  AlignmentType, Document, Footer, Header, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import type { Statements } from '@auditos/fs-engine';
import { blocks, footerText, titleText, type Block, type ExportMeta } from './model';

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
            children: meta.draft
              ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DRAFT: not approved for issue', bold: true, color: 'C00000', size: 28 })] })]
              : [new Paragraph({ children: [] })],
          }),
        },
        footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: footerText(meta), size: 16 })] })] }) },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
