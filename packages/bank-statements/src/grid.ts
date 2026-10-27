import ExcelJS from 'exceljs';
import { StatementError, type Line } from './types';

const asLine = (cells: string[]): Line => cells.map((text, i) => ({ text, x: i, right: i })).filter((c) => c.text.trim() !== '');

/** The delimiter that splits the first few lines into the most fields. */
function delimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  let best = ',';
  let bestCount = -1;
  for (const d of [',', ';', '\t', '|']) {
    let count = 0;
    let quoted = false;
    for (const ch of sample) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 style CSV: quoted fields may contain the delimiter, doubled quotes and line breaks. */
export function csvRows(text: string): string[][] {
  const d = delimiter(text.replace(/^﻿/, ''));
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvLines(text: string): Line[] {
  return csvRows(text).map(asLine).filter((l) => l.length > 0);
}

/** The first worksheet of a workbook, as the text a person would see in each cell. */
export async function xlsxLines(data: Uint8Array): Promise<Line[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(data) as unknown as ArrayBuffer);
  } catch {
    throw new StatementError('unreadable_file', 'This file could not be opened as an Excel workbook.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new StatementError('no_table_found', 'The workbook has no sheets.');
  const lines: Line[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const v = cell.value;
      let text: string;
      if (v === null || v === undefined) text = '';
      else if (typeof v === 'number') text = String(v);
      else if (v instanceof Date) text = v.toISOString().slice(0, 10);
      else text = cell.text ?? String(v);
      cells[col - 1] = text;
    });
    for (let i = 0; i < cells.length; i++) cells[i] ??= '';
    const line = asLine(cells);
    if (line.length > 0) lines.push(line);
  });
  return lines;
}
