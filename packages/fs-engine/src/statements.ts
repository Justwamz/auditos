import { buildCashFlowIndirect, type CashFlow } from './cashflow';
import { computeFigures, type Figures, type FsException } from './figures';
import { resolveFramework, type Framework, type FrameworkVersion } from './framework';
import { TAXONOMY, type MappedTb } from './mapping';
import type { Money } from './money';

export type { FsException } from './figures';

export interface Row {
  id: string;
  label: string;
  current: Money;
  prior?: Money;
  subtotal?: boolean;
}
export interface Section {
  id: string;
  label: string;
  rows: Row[];
  total: Money;
  priorTotal?: Money;
}
export interface Sofp {
  sections: Section[];
  totalAssets: Money;
  totalEquityAndLiabilities: Money;
  priorTotalAssets?: Money;
  priorTotalEquityAndLiabilities?: Money;
}
export interface Pl {
  rows: Row[];
  profit: Money;
  priorProfit?: Money;
}
export type EquityColumn = 'share_capital' | 'other_reserves' | 'retained_earnings' | 'total';
export interface EquityRow {
  id: 'opening' | 'issues' | 'profit' | 'dividends' | 'closing';
  label: string;
  values: Record<EquityColumn, Money>;
}
export interface Note {
  id: string;
  title: string;
  rows: Row[];
}
export interface Statements {
  framework: FrameworkVersion;
  periodStart: string;
  periodEnd: string;
  hasComparatives: boolean;
  sofp: Sofp;
  pl: Pl;
  equity: { rows: EquityRow[]; priorRows?: EquityRow[] };
  cashflow?: CashFlow;
  notes: Note[];
}

export type BuildResult =
  | { ok: true; statements: Statements; exceptions: FsException[] }
  | { ok: false; blockers: FsException[] };

export interface BuildOptions {
  periodStart: string;
  periodEnd: string;
  framework: Framework;
  prior?: MappedTb;
}

const SOFP_SECTIONS: [string, string][] = [
  ['non_current_assets', 'Non-current assets'],
  ['current_assets', 'Current assets'],
  ['equity', 'Equity'],
  ['non_current_liabilities', 'Non-current liabilities'],
  ['current_liabilities', 'Current liabilities'],
];

function blockers(m: MappedTb): FsException[] {
  const out: FsException[] = [];
  if (m.empty) out.push({ code: 'empty', message: 'The trial balance is empty or all zero' });
  if (!m.balanced) {
    out.push({
      code: 'unbalanced',
      message: 'Debits and credits differ',
      detail: { difference: (m.totalDebit - m.totalCredit).toString() },
    });
  }
  if (m.unmapped.length > 0) {
    out.push({
      code: 'unmapped',
      message: `${m.unmapped.length} account(s) are not mapped to a statement line`,
      detail: m.unmapped.map((l) => ({ code: l.code, name: l.name })),
    });
  }
  return out;
}

function sofpRows(f: Figures, p: Figures | undefined, sectionId: string): Row[] {
  const g = (fig: Figures | undefined, id: string) => fig?.get(id) ?? 0n;
  const rows: Row[] = [];
  for (const l of TAXONOMY.filter((x) => x.statement === 'sofp' && x.section === sectionId)) {
    const isRetained = l.id === 'retained_earnings';
    const id = l.id;
    const current = isRetained ? g(f, 'closing_retained') : g(f, id);
    const prior = p ? (isRetained ? g(p, 'closing_retained') : g(p, id)) : undefined;
    if (current === 0n && (prior ?? 0n) === 0n && id !== 'cash') continue;
    rows.push({ id, label: isRetained ? 'Retained earnings' : l.label, current, ...(p ? { prior } : {}) });
  }
  return rows;
}

function buildSofp(f: Figures, p: Figures | undefined): Sofp {
  const sections: Section[] = SOFP_SECTIONS.map(([id, label]) => {
    const rows = sofpRows(f, p, id);
    const total = rows.reduce((a, r) => a + r.current, 0n);
    const priorTotal = p ? rows.reduce((a, r) => a + (r.prior ?? 0n), 0n) : undefined;
    return { id, label, rows, total, ...(p ? { priorTotal } : {}) };
  });
  const sum = (ids: string[], key: 'total' | 'priorTotal') =>
    sections.filter((s) => ids.includes(s.id)).reduce((a, s) => a + (s[key] ?? 0n), 0n);
  const assets = ['non_current_assets', 'current_assets'];
  const el = ['equity', 'non_current_liabilities', 'current_liabilities'];
  return {
    sections,
    totalAssets: sum(assets, 'total'),
    totalEquityAndLiabilities: sum(el, 'total'),
    ...(p ? { priorTotalAssets: sum(assets, 'priorTotal'), priorTotalEquityAndLiabilities: sum(el, 'priorTotal') } : {}),
  };
}

function buildPl(f: Figures, p: Figures | undefined): Pl {
  const row = (id: string, label: string, sign: 1n | -1n, subtotal = false): Row => ({
    id,
    label,
    current: sign * (f.get(id) ?? 0n),
    ...(p ? { prior: sign * (p.get(id) ?? 0n) } : {}),
    ...(subtotal ? { subtotal } : {}),
  });
  const rows: Row[] = [
    row('revenue_total', 'Revenue', 1n),
    row('cost_of_sales', 'Cost of sales', -1n),
    row('gross_profit', 'Gross profit', 1n, true),
    row('other_income', 'Other income', 1n),
    row('fair_value_gain', 'Fair value gain on investment property', 1n),
    row('selling_expenses', 'Selling and distribution expenses', -1n),
    row('admin_expenses', 'Administrative expenses', -1n),
    row('depreciation', 'Depreciation and amortisation', -1n),
    row('operating_profit', 'Operating profit', 1n, true),
    row('finance_costs', 'Finance costs', -1n),
    row('profit_before_tax', 'Profit before tax', 1n, true),
    row('income_tax', 'Income tax expense', -1n),
    row('profit', 'Profit for the year', 1n, true),
  ].filter((r) => r.subtotal || r.current !== 0n || (r.prior ?? 0n) !== 0n);
  return { rows, profit: f.get('profit') ?? 0n, ...(p ? { priorProfit: p.get('profit') ?? 0n } : {}) };
}

function buildEquity(f: Figures, p?: Figures): EquityRow[] {
  const g = (id: string) => f.get(id) ?? 0n;
  const pg = (id: string) => (p ? (p.get(id) ?? 0n) : g(id));
  const mk = (id: EquityRow['id'], label: string, sc: Money, or: Money, re: Money): EquityRow => ({
    id,
    label,
    values: { share_capital: sc, other_reserves: or, retained_earnings: re, total: sc + or + re },
  });
  const issuedCapital = g('share_capital') - pg('share_capital');
  const issuedReserves = g('other_reserves') - pg('other_reserves');
  return [
    mk('opening', 'Balance at start of period', pg('share_capital'), pg('other_reserves'), g('retained_earnings')),
    ...(issuedCapital !== 0n || issuedReserves !== 0n
      ? [mk('issues', 'Shares issued and other movements', issuedCapital, issuedReserves, 0n)]
      : []),
    mk('profit', 'Profit for the year', 0n, 0n, g('profit')),
    mk('dividends', 'Dividends declared', 0n, 0n, -g('dividends')),
    mk('closing', 'Balance at end of period', g('share_capital'), g('other_reserves'), g('closing_retained')),
  ];
}

function buildNotes(f: Figures, p: Figures | undefined): Note[] {
  const mk = (id: string, label: string): Row => ({
    id,
    label,
    current: f.get(id) ?? 0n,
    ...(p ? { prior: p.get(id) ?? 0n } : {}),
  });
  const notes: Note[] = [];
  if ((f.get('revenue_total') ?? 0n) !== 0n) {
    notes.push({ id: 'revenue-note', title: 'Revenue', rows: [mk('revenue', 'Sale of goods and services'), mk('rental_income', 'Rental income')] });
  }
  notes.push({ id: 'cash-note', title: 'Cash and cash equivalents', rows: [mk('cash', 'Cash and bank balances'), mk('bank_overdraft', 'Bank overdraft')] });
  notes.push({ id: 'tax-note', title: 'Income tax', rows: [mk('income_tax', 'Income tax expense'), mk('tax_payable', 'Current tax payable')] });
  return notes;
}

export function buildStatements(m: MappedTb, opts: BuildOptions): BuildResult {
  const stop = blockers(m);
  if (stop.length > 0) return { ok: false, blockers: stop };

  const framework = resolveFramework(opts.framework, opts.periodStart);
  const exceptions: FsException[] = [];
  const f = computeFigures(m, exceptions);
  const p = opts.prior ? computeFigures(opts.prior) : undefined;

  const cf = buildCashFlowIndirect(m, opts.prior);
  exceptions.push(...cf.exceptions);

  const statements: Statements = {
    framework,
    periodStart: opts.periodStart,
    periodEnd: opts.periodEnd,
    hasComparatives: p !== undefined,
    sofp: buildSofp(f, p),
    pl: buildPl(f, p),
    equity: { rows: buildEquity(f, p), ...(p ? { priorRows: buildEquity(p) } : {}) },
    ...(cf.statement ? { cashflow: cf.statement } : {}),
    notes: buildNotes(f, p),
  };
  return { ok: true, statements, exceptions };
}
