import taxonomy from '@auditos/standards/content/fs-taxonomy.json';
import type { Money } from './money';

export interface TbLine {
  code: string;
  name: string;
  debit: Money;
  credit: Money;
}
export type Mapping = Record<string, string>;

export interface TaxonomyLine {
  id: string;
  label: string;
  statement: 'sofp' | 'pl' | 'equity';
  section: string;
  side: 'debit' | 'credit';
}
export const TAXONOMY: TaxonomyLine[] = taxonomy.lines as TaxonomyLine[];
const BY_ID = new Map(TAXONOMY.map((l) => [l.id, l]));

export interface MappedAccount {
  code: string;
  name: string;
  line: string;
  /** Value in the line's natural direction; negative means the account has the opposite balance. */
  value: Money;
}

export interface MappedTb {
  lines: Map<string, Money>;
  /** Per-account values, so opposite-sign balances can be reclassified account by account. */
  accounts?: MappedAccount[];
  unmapped: TbLine[];
  totalDebit: Money;
  totalCredit: Money;
  balanced: boolean;
  empty: boolean;
}

export function mapTrialBalance(tb: TbLine[], mapping: Mapping): MappedTb {
  const lines = new Map<string, Money>();
  const unmapped: TbLine[] = [];
  const accounts: MappedAccount[] = [];
  let totalDebit = 0n;
  let totalCredit = 0n;
  for (const row of tb) {
    totalDebit += row.debit;
    totalCredit += row.credit;
    const line = BY_ID.get(mapping[row.code] ?? '');
    if (!line) {
      unmapped.push(row);
      continue;
    }
    const natural = line.side === 'debit' ? row.debit - row.credit : row.credit - row.debit;
    lines.set(line.id, (lines.get(line.id) ?? 0n) + natural);
    accounts.push({ code: row.code, name: row.name, line: line.id, value: natural });
  }
  const empty = tb.every((r) => r.debit === 0n && r.credit === 0n);
  return { lines, accounts, unmapped, totalDebit, totalCredit, balanced: totalDebit === totalCredit, empty };
}

const KEYWORDS: [RegExp, string][] = [
  [/overdraft/i, 'bank_overdraft'],
  [/bank charge|interest (paid|expense)|finance (cost|charge)/i, 'finance_costs'],
  [/accumulated (depreciation|amortisation|amortization)/i, 'ppe'],
  [/depreciation|amortisation|amortization/i, 'depreciation'],
  [/rent(al)?\s+(income|received)|rental income/i, 'rental_income'],
  [/investment propert/i, 'investment_property'],
  [/stock|inventor|goods for resale/i, 'inventories'],
  [/debtor|receivable/i, 'trade_receivables'],
  [/creditor|payable|accrual/i, 'trade_payables'],
  [/cash|bank|mpesa|m-pesa/i, 'cash'],
  [/share capital|paid.?up/i, 'share_capital'],
  [/retained|accumulated (profit|earnings)/i, 'retained_earnings'],
  [/dividend/i, 'dividends'],
  [/loan|borrowing|mortgage/i, 'borrowings_nc'],
  [/deferred tax/i, 'deferred_tax'],
  [/income tax|corporation tax|tax expense/i, 'income_tax'],
  [/fixed asset|property|plant|equipment|motor vehicle|furniture|computer/i, 'ppe'],
  [/cost of (sales|goods)|purchases/i, 'cost_of_sales'],
  [/audit fee|accountancy|legal fee|salar|wage|rent|utilit|office|admin|insurance|repair|travel|stationery/i, 'admin_expenses'],
  [/advertis|marketing|distribution|delivery/i, 'selling_expenses'],
  [/sales|revenue|fees|turnover/i, 'revenue'],
];

export function suggestMapping(tb: TbLine[], prior: Mapping = {}): Mapping {
  const out: Mapping = {};
  for (const row of tb) {
    const known = prior[row.code];
    if (known) {
      out[row.code] = known;
      continue;
    }
    const hit = KEYWORDS.find(([re]) => re.test(row.name));
    if (hit) out[row.code] = hit[1];
  }
  return out;
}
