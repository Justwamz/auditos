import ExcelJS from 'exceljs';
import { parseAmount } from '@auditos/bank-statements';
import type { PopulationItem } from '@auditos/fs-engine';
import { parseCsv } from '../financials/parse';

export const MAX_POPULATION = 50_000;

export interface PopulationError { row: number; message: string }
export type PopulationResult = { ok: true; items: PopulationItem[] } | { ok: false; error: string; rows?: PopulationError[] };

const REF = /^(ref|reference|invoice|inv|document|doc|voucher|no|number|id|item)\b/i;
const DESC = /desc|detail|narr|name|particular|supplier|customer|payee/i;
const AMOUNT = /amount|value|total|balance|gross|net|debit/i;

async function xlsxRows(data: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws?.eachRow({ includeEmpty: false }, (r) => {
    const cells: string[] = [];
    r.eachCell({ includeEmpty: true }, (c, col) => {
      const v = c.value;
      cells[col - 1] = v === null || v === undefined ? '' : typeof v === 'object' && 'result' in v ? String((v as { result?: unknown }).result ?? '') : typeof v === 'object' && 'text' in v ? String((v as { text: unknown }).text) : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    });
    rows.push(Array.from(cells, (x) => x ?? ''));
  });
  return rows;
}

/**
 * Reads a population (invoices, payments, balances) from CSV or Excel: a heading row with an amount column, and optionally
 * a reference and a description. A row whose amount cannot be read stops the upload: a population with rows silently
 * missing would make the sample unrepresentative.
 */
export async function parsePopulation(filename: string, data: Buffer): Promise<PopulationResult> {
  const n = filename.toLowerCase();
  let rows: string[][];
  try {
    if (n.endsWith('.csv')) rows = parseCsv(data.toString('utf8'));
    else if (n.endsWith('.xlsx')) rows = await xlsxRows(data);
    else return { ok: false, error: 'unsupported_type' };
  } catch {
    return { ok: false, error: 'unreadable_file' };
  }
  rows = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const headIndex = rows.findIndex((r) => r.some((c) => AMOUNT.test(c)));
  if (headIndex < 0) return { ok: false, error: 'no_amount_column' };
  const head = rows[headIndex]!.map((c) => c.trim());
  const amountCol = head.findIndex((c) => AMOUNT.test(c));
  const refCol = head.findIndex((c, i) => i !== amountCol && REF.test(c));
  const descCol = head.findIndex((c, i) => i !== amountCol && i !== refCol && DESC.test(c));
  const body = rows.slice(headIndex + 1);
  if (body.length === 0) return { ok: false, error: 'empty_population' };
  if (body.length > MAX_POPULATION) return { ok: false, error: 'too_many_rows' };

  const items: PopulationItem[] = [];
  const errors: PopulationError[] = [];
  body.forEach((r, i) => {
    const amount = parseAmount((r[amountCol] ?? '').trim());
    const rowNumber = headIndex + i + 2;
    if (!amount) {
      if (errors.length < 20) errors.push({ row: rowNumber, message: `The amount "${(r[amountCol] ?? '').slice(0, 30)}" could not be read` });
      return;
    }
    const sign = amount.side === 'cr' ? -1n : 1n;
    items.push({
      ref: ((refCol >= 0 ? r[refCol] : '') ?? '').trim().slice(0, 100) || `Row ${rowNumber}`,
      description: ((descCol >= 0 ? r[descCol] : '') ?? '').trim().slice(0, 300),
      amountCents: amount.side === null ? amount.cents : sign * amount.cents,
    });
  });
  if (errors.length > 0) return { ok: false, error: 'unreadable_rows', rows: errors };
  return { ok: true, items };
}
