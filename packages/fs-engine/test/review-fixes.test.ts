import { describe, expect, test } from 'vitest';
import { mapTrialBalance, suggestMapping, type MappedTb, type TbLine } from '../src/mapping';
import { buildStatements } from '../src/statements';
import { buildCashFlowIndirect } from '../src/cashflow';
import { disclosureChecklist } from '../src/disclosures';

const opts = { periodStart: '2026-01-01', periodEnd: '2026-12-31', framework: 'IFRS_SME' as const };
const mt = (lines: Record<string, bigint>): MappedTb => ({
  lines: new Map(Object.entries(lines)),
  unmapped: [],
  totalDebit: 0n,
  totalCredit: 0n,
  balanced: true,
  empty: false,
});
const tb = (code: string, name: string, d: bigint, c: bigint): TbLine => ({ code, name, debit: d, credit: c });

describe('statement of changes in equity ties to the prior year', () => {
  test('opening equity is last year’s closing equity and share issues are shown', () => {
    const prior = mt({ cash: 150n, share_capital: 50n, retained_earnings: 100n });
    const current = mt({ cash: 300n, share_capital: 100n, retained_earnings: 100n, revenue: 100n });
    const r = buildStatements(current, { ...opts, prior });
    if (!r.ok) throw new Error('blocked');
    const rows = r.statements.equity.rows;
    expect(rows.map((x) => x.id)).toEqual(['opening', 'issues', 'profit', 'dividends', 'closing']);
    const get = (id: string) => rows.find((x) => x.id === id)!.values;
    expect(get('opening').share_capital).toBe(50n);
    expect(get('opening').total).toBe(150n);
    expect(get('issues').share_capital).toBe(50n);
    expect(get('closing').total).toBe(300n);
    expect(get('opening').total + get('issues').total + get('profit').total + get('dividends').total).toBe(get('closing').total);
    expect(r.statements.sofp.priorTotalAssets).toBe(150n);
  });

  test('without a prior year there is no issues row and opening equals the trial balance', () => {
    const r = buildStatements(mt({ cash: 100n, share_capital: 100n }), opts);
    if (!r.ok) throw new Error('blocked');
    expect(r.statements.equity.rows.map((x) => x.id)).toEqual(['opening', 'profit', 'dividends', 'closing']);
  });
});

describe('opposite-sign balances are reclassified per account', () => {
  test('an overdrawn bank account is not netted against positive bank balances', () => {
    const m = mapTrialBalance(
      [tb('1', 'Bank A', 100n, 0n), tb('2', 'Bank B overdrawn', 0n, 30n), tb('3', 'Capital', 0n, 70n)],
      { '1': 'cash', '2': 'cash', '3': 'share_capital' },
    );
    const r = buildStatements(m, opts);
    if (!r.ok) throw new Error('blocked');
    const rows = r.statements.sofp.sections.flatMap((s) => s.rows);
    expect(rows.find((x) => x.id === 'cash')?.current).toBe(100n);
    expect(rows.find((x) => x.id === 'bank_overdraft')?.current).toBe(30n);
    expect(r.exceptions.map((e) => e.code)).toContain('reclassified-balance');
    expect(r.statements.sofp.totalAssets).toBe(100n);
    expect(r.statements.sofp.totalEquityAndLiabilities).toBe(100n);
  });

  test('customers with credit balances move to payables while others stay in receivables', () => {
    const m = mapTrialBalance(
      [tb('1', 'Customer A', 80n, 0n), tb('2', 'Customer B credit', 0n, 20n), tb('3', 'Capital', 0n, 60n)],
      { '1': 'trade_receivables', '2': 'trade_receivables', '3': 'share_capital' },
    );
    const r = buildStatements(m, opts);
    if (!r.ok) throw new Error('blocked');
    const rows = r.statements.sofp.sections.flatMap((s) => s.rows);
    expect(rows.find((x) => x.id === 'trade_receivables')?.current).toBe(80n);
    expect(rows.find((x) => x.id === 'trade_payables')?.current).toBe(20n);
  });
});

describe('cash flow always reconciles visibly', () => {
  test('a broken retained-earnings roll-forward shows an unreconciled line instead of a statement that does not add up', () => {
    const prior = mt({ cash: 100n, inventories: 50n, ppe: 200n, trade_payables: 60n, share_capital: 100n, retained_earnings: 190n });
    const current = mt({
      cash: 135n, inventories: 80n, ppe: 220n, trade_payables: 70n, share_capital: 100n, retained_earnings: 195n,
      revenue: 300n, cost_of_sales: 150n, admin_expenses: 50n, depreciation: 30n,
    });
    const r = buildCashFlowIndirect(current, prior);
    const s = r.statement!;
    expect(s.netMovement).toBe(s.closingCash - s.openingCash);
    expect(s.rows.find((x) => x.id === 'unreconciled')?.current).toBe(5n);
    expect(r.exceptions.map((e) => e.code)).toEqual(expect.arrayContaining(['retained-earnings-rollforward', 'cashflow-unreconciled']));
  });

  test('a consistent year has no unreconciled line', () => {
    const prior = mt({ cash: 100n, inventories: 50n, ppe: 200n, trade_payables: 60n, share_capital: 100n, retained_earnings: 190n });
    const current = mt({
      cash: 130n, inventories: 80n, ppe: 220n, trade_payables: 70n, share_capital: 100n, retained_earnings: 190n,
      revenue: 300n, cost_of_sales: 150n, admin_expenses: 50n, depreciation: 30n,
    });
    const r = buildCashFlowIndirect(current, prior);
    expect(r.statement!.rows.some((x) => x.id === 'unreconciled')).toBe(false);
    expect(r.exceptions).toEqual([]);
  });
});

describe('first-year entities can explain the missing comparatives', () => {
  const build = () => {
    const r = buildStatements(mt({ cash: 100n, share_capital: 100n }), opts);
    if (!r.ok) throw new Error('blocked');
    return r.statements;
  };
  test('comparatives and cash flow items point at the explanatory note and stay open without it', () => {
    const c = disclosureChecklist('IFRS_SME_2E', build());
    for (const id of ['comparatives', 'cashflow']) {
      const item = c.find((i) => i.id === id)!;
      expect(item.satisfied).toBe(false);
      expect(item.noteId).toBe('no-comparatives');
    }
  });
  test('a no-comparatives note satisfies both', () => {
    const s = build();
    s.notes.push({ id: 'no-comparatives', title: 'No comparatives', rows: [] });
    const c = disclosureChecklist('IFRS_SME_2E', s);
    expect(c.find((i) => i.id === 'comparatives')?.satisfied).toBe(true);
    expect(c.find((i) => i.id === 'cashflow')?.satisfied).toBe(true);
  });
  test('the note does not hide missing comparatives when they exist', () => {
    const prior = mt({ cash: 100n, share_capital: 100n });
    const r = buildStatements(mt({ cash: 100n, share_capital: 100n }), { ...opts, prior });
    if (!r.ok) throw new Error('blocked');
    const c = disclosureChecklist('IFRS_SME_2E', r.statements);
    expect(c.find((i) => i.id === 'comparatives')?.satisfied).toBe(true);
    expect(c.find((i) => i.id === 'comparatives')?.noteId).toBeUndefined();
  });
});

describe('mapping suggestions', () => {
  test.each([
    ['Bank charges', 'finance_costs'],
    ['Audit fees', 'admin_expenses'],
    ['Accumulated depreciation', 'ppe'],
    ['Professional fees', 'revenue'],
    ['Depreciation expense', 'depreciation'],
    ['Cash at bank', 'cash'],
  ])('%s is suggested as %s', (name, line) => {
    expect(suggestMapping([tb('1', name, 1n, 0n)])['1']).toBe(line);
  });
});
