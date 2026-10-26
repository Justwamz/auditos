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

export interface MappedTb {
  lines: Map<string, Money>;
  unmapped: TbLine[];
  totalDebit: Money;
  totalCredit: Money;
  balanced: boolean;
  empty: boolean;
}

export function mapTrialBalance(tb: TbLine[], mapping: Mapping): MappedTb {
  const lines = new Map<string, Money>();
  const unmapped: TbLine[] = [];
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
  }
  const empty = tb.every((r) => r.debit === 0n && r.credit === 0n);
  return { lines, unmapped, totalDebit, totalCredit, balanced: totalDebit === totalCredit, empty };
}

const KEYWORDS: [RegExp, string][] = [
  [/overdraft/i, 'bank_overdraft'],
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
  [/depreciation|amortisation|amortization/i, 'depreciation'],
  [/fixed asset|property|plant|equipment|motor vehicle|furniture|computer/i, 'ppe'],
  [/interest (paid|expense)|finance (cost|charge)|bank charge/i, 'finance_costs'],
  [/cost of (sales|goods)|purchases/i, 'cost_of_sales'],
  [/sales|revenue|fees|turnover/i, 'revenue'],
  [/salar|wage|rent|utilit|office|admin|audit fee|insurance|repair|travel|stationery/i, 'admin_expenses'],
  [/advertis|marketing|distribution|delivery/i, 'selling_expenses'],
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
