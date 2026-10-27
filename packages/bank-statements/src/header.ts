import type { Line } from './types';

export type Role = 'date' | 'description' | 'debit' | 'credit' | 'amount' | 'balance' | 'reference' | 'ignore';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** What each printed heading means. The first matching entry wins; order matters for words that appear in several. */
const HEADINGS: [Role, string[]][] = [
  ['date', ['date', 'txn date', 'trans date', 'tran date', 'transaction date', 'posting date', 'post date', 'booking date', 'completion time', 'time', 'processed date']],
  ['ignore', ['value date', 'value dt', 'val date', 'transaction status', 'status', 'type', 'channel', 'branch']],
  ['reference', ['receipt no', 'receipt', 'ref', 'ref no', 'reference', 'reference no', 'cheque no', 'chq no', 'transaction id', 'trans id']],
  ['description', ['description', 'details', 'narrative', 'narration', 'particulars', 'transaction details', 'transaction description', 'remarks', 'memo', 'transaction', 'trans details']],
  ['debit', ['debit', 'debits', 'dr', 'withdrawal', 'withdrawals', 'withdrawn', 'paid out', 'money out', 'payments', 'payment', 'debit amount', 'amount debited', 'out']],
  ['credit', ['credit', 'credits', 'cr', 'deposit', 'deposits', 'paid in', 'money in', 'receipts', 'credit amount', 'amount credited', 'in']],
  ['amount', ['amount', 'transaction amount', 'amt', 'value']],
  ['balance', ['balance', 'running balance', 'ledger balance', 'available balance', 'closing balance', 'bal']],
];

export function roleOf(heading: string): Role | null {
  const h = norm(heading);
  if (h === '') return null;
  for (const [role, words] of HEADINGS) if (words.includes(h)) return role;
  return null;
}

export interface Column {
  role: Role;
  heading: string;
  x: number;
  right: number;
}

/** The first line that reads as the heading of a statement table: a date column and at least one money column. */
export function findHeader(lines: Line[]): { index: number; columns: Column[] } | null {
  for (let i = 0; i < lines.length; i++) {
    const columns: Column[] = [];
    for (const cell of lines[i]!) {
      const role = roleOf(cell.text);
      if (role) columns.push({ role, heading: cell.text.trim(), x: cell.x, right: cell.right });
    }
    const roles = new Set(columns.map((c) => c.role));
    const money = ['debit', 'credit', 'amount', 'balance'].filter((r) => roles.has(r as Role)).length;
    if (roles.has('date') && money >= 1 && (roles.has('description') || money >= 2)) return { index: i, columns };
  }
  return null;
}
