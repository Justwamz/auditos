import ExcelJS from 'exceljs';
import { formatMoney, parseMoney } from '@auditos/fs-engine';

export const MAX_TB_ROWS = 5000;

export interface TbRowText {
  code: string;
  name: string;
  debit: string;
  credit: string;
}
export interface RowError {
  row: number;
  message: string;
}
export type ParseResult = { ok: true; lines: TbRowText[] } | { ok: false; error: string; rows?: RowError[] };

/** RFC 4180-style CSV: quotes, escaped quotes, commas and newlines inside quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readXlsx(data: Buffer): Promise<{ rows: string[][]; errors: RowError[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], errors: [] };
  const rows: string[][] = [];
  const errors: RowError[] = [];
  ws.eachRow({ includeEmpty: false }, (r, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= 4; c++) {
      const v = r.getCell(c).value;
      if (v !== null && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) {
        errors.push({ row: rowNumber, message: 'Formulas are not allowed; paste values only' });
        cells.push('');
      } else if (typeof v === 'number') {
        if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) errors.push({ row: rowNumber, message: 'Amount has more than 2 decimals' });
        cells.push(v.toFixed(2));
      } else if (v instanceof Date) {
        errors.push({ row: rowNumber, message: 'Dates are not valid in a trial balance' });
        cells.push('');
      } else if (v !== null && typeof v === 'object') {
        cells.push('rich' in v ? String((v as { richText?: { text: string }[] }).richText?.map((t) => t.text).join('') ?? '') : String(v));
      } else cells.push(v === null || v === undefined ? '' : String(v));
    }
    rows.push(cells);
  });
  return { rows, errors };
}

function amount(raw: string | undefined, label: string, row: number, errors: RowError[]): string {
  const s = (raw ?? '').trim();
  if (s === '') return '0.00';
  try {
    const m = parseMoney(s);
    if (m < 0n) {
      errors.push({ row, message: `${label} must not be negative` });
      return '0.00';
    }
    return formatMoney(m);
  } catch {
    errors.push({ row, message: `${label} is not a valid amount` });
    return '0.00';
  }
}

export async function parseTbUpload(filename: string, data: Buffer): Promise<ParseResult> {
  const lower = filename.toLowerCase();
  let rows: string[][];
  const errors: RowError[] = [];
  if (lower.endsWith('.csv')) {
    rows = parseCsv(data.toString('utf8'));
  } else if (lower.endsWith('.xlsx')) {
    try {
      const x = await readXlsx(data);
      rows = x.rows;
      errors.push(...x.errors);
    } catch {
      return { ok: false, error: 'invalid_file' };
    }
  } else {
    return { ok: false, error: 'unsupported_type' };
  }

  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  if (['code', 'name', 'debit', 'credit'].some((n) => idx(n) < 0)) {
    return { ok: false, error: 'missing_columns', rows: [{ row: 1, message: 'Header must contain: code, name, debit, credit' }] };
  }
  const body = rows.slice(1).map((cells, i) => ({ cells, row: i + 2 })).filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (body.length > MAX_TB_ROWS) return { ok: false, error: 'too_many_rows' };

  const seen = new Set<string>();
  const lines: TbRowText[] = [];
  for (const { cells, row } of body) {
    const code = (cells[idx('code')] ?? '').trim();
    const name = (cells[idx('name')] ?? '').trim();
    if (!code || code.length > 30) errors.push({ row, message: 'Account code is required (30 characters maximum)' });
    else if (seen.has(code)) errors.push({ row, message: `Duplicate account code ${code}` });
    seen.add(code);
    if (!name || name.length > 200) errors.push({ row, message: 'Account name is required (200 characters maximum)' });
    lines.push({
      code,
      name,
      debit: amount(cells[idx('debit')], 'Debit', row, errors),
      credit: amount(cells[idx('credit')], 'Credit', row, errors),
    });
  }
  if (errors.length > 0) {
    const unique = errors.filter((e, i) => errors.findIndex((x) => x.row === e.row && x.message === e.message) === i);
    return { ok: false, error: 'invalid_rows', rows: unique.sort((a, b) => a.row - b.row) };
  }
  if (lines.length === 0) return { ok: false, error: 'invalid_rows', rows: [{ row: 2, message: 'The file has no accounts' }] };
  return { ok: true, lines };
}
