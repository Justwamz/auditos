import ExcelJS from 'exceljs';
import type { Statements } from '@auditos/fs-engine';
import { blocks, contactLine, escapeCell, footerText, letterheadName, titleText, type ExportMeta } from './model';

const SHEET_NAMES: Record<string, string> = {
  'Statement of financial position': 'Financial position',
  'Statement of profit or loss': 'Profit or loss',
  'Statement of changes in equity': 'Changes in equity',
  'Statement of cash flows': 'Cash flows',
};

export async function exportXlsx(s: Statements, meta: ExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AuditOS';
  const banner = meta.draft ? `DRAFT: ${titleText(meta)}` : titleText(meta);

  for (const b of blocks(s)) {
    const name = (SHEET_NAMES[b.title] ?? b.title.replace(/^Note: /, 'Note ')).slice(0, 31).replace(/[\\/?*[\]:]/g, ' ');
    const ws = wb.addWorksheet(name);
    if (meta.letterhead) {
      // One header row of text: the firm name, then the contact line when there is one. No picture in Excel.
      const contact = contactLine(meta.letterhead);
      ws.addRow([escapeCell([letterheadName(meta.letterhead), contact].filter(Boolean).join(' | '))]).font = { bold: true };
    }
    ws.addRow([banner]).font = { bold: true, color: { argb: meta.draft ? 'FFC00000' : 'FF000000' } };
    ws.addRow([b.title]).font = { bold: true };
    ws.addRow(b.head).font = { bold: true };
    for (const r of b.rows) ws.addRow(r.cells.map(escapeCell)).font = { bold: r.bold === true };
    ws.addRow([]);
    ws.addRow([escapeCell(footerText(meta))]).font = { italic: true, size: 9 };
    ws.getColumn(1).width = 48;
    for (let c = 2; c <= 5; c++) ws.getColumn(c).width = 18;
  }

  if (meta.trialBalance) {
    const ws = wb.addWorksheet('Trial balance');
    ws.addRow(['Code', 'Account name', 'Debit', 'Credit']).font = { bold: true };
    for (const l of meta.trialBalance) {
      // Plain strings only: no formulas are ever written, and names that look like formulas are escaped.
      ws.addRow([escapeCell(l.code), escapeCell(l.name), Number(l.debit) / 100, Number(l.credit) / 100]);
    }
    ws.getColumn(2).width = 40;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
