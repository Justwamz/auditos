import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { mapTrialBalance, type MappedTb } from '../src/mapping';
import { buildStatements, type Statements } from '../src/statements';
import { consultancy, rental, trading, type Fixture } from './fixtures';

const opts = { periodStart: '2026-01-01', periodEnd: '2026-12-31', framework: 'IFRS_SME' as const };
const mapped = (f: Fixture) => mapTrialBalance(f.tb, f.mapping);
const mt = (lines: Record<string, bigint>): MappedTb => ({
  lines: new Map(Object.entries(lines)),
  unmapped: [],
  totalDebit: 0n,
  totalCredit: 0n,
  balanced: true,
  empty: false,
});
const ok = (r: ReturnType<typeof buildStatements>) => {
  if (!r.ok) throw new Error(`blocked: ${JSON.stringify(r.blockers.map((b) => b.code))}`);
  return r;
};
const sofpRow = (s: Statements, id: string) =>
  s.sofp.sections.flatMap((x) => x.rows).find((r) => r.id === id);
const sectionOf = (s: Statements, id: string) =>
  s.sofp.sections.find((x) => x.rows.some((r) => r.id === id))?.id;

describe.each([
  ['trading', trading],
  ['consultancy', consultancy],
  ['rental', rental],
])('%s golden statements', (_name, fx) => {
  test('profit, total assets and the accounting equation match hand calculations', () => {
    const { statements: s } = ok(buildStatements(mapped(fx), opts));
    expect(s.pl.profit).toBe(fx.expectedProfit);
    expect(s.sofp.totalAssets).toBe(fx.expectedAssets);
    expect(s.sofp.totalEquityAndLiabilities).toBe(s.sofp.totalAssets);
  });
  test('output matches the golden file', async () => {
    const { statements } = ok(buildStatements(mapped(fx), opts));
    const json = JSON.stringify(statements, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
    await expect(json).toMatchFileSnapshot(`golden/${_name}.json`);
  });
});

describe('blockers', () => {
  test('unbalanced TB returns ok:false with blocker unbalanced and no statements', () => {
    const tb = [...trading.tb, { code: '9999', name: 'Suspense', debit: 1n, credit: 0n }];
    const r = buildStatements(mapTrialBalance(tb, { ...trading.mapping, 9999: 'cash' }), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.map((b) => b.code)).toContain('unbalanced');
  });
  test('unmapped account blocks with the account listed', () => {
    const r = buildStatements(mapTrialBalance(trading.tb, { ...trading.mapping, 1000: 'nope' }), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const b = r.blockers.find((x) => x.code === 'unmapped');
      expect(JSON.stringify(b?.detail)).toContain('1000');
    }
  });
  test('empty or all-zero TB blocks with empty', () => {
    const r = buildStatements(mapTrialBalance([], {}), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.map((b) => b.code)).toContain('empty');
  });
});

describe('comparatives and reclassification', () => {
  test('first-year audit builds statements with no prior column and omits cash flow', () => {
    const r = ok(buildStatements(mapped(trading), opts));
    expect(r.statements.cashflow).toBeUndefined();
    expect(r.statements.hasComparatives).toBe(false);
    expect(sofpRow(r.statements, 'ppe')?.prior).toBeUndefined();
    expect(r.exceptions.map((e) => e.code)).toContain('no-comparatives');
  });
  test('bank overdraft (credit balance in bank) shows under current liabilities with reclassified-balance', () => {
    const t = mt({ cash: -50n, trade_receivables: 150n, share_capital: 100n });
    const r = ok(buildStatements(t, opts));
    expect(sectionOf(r.statements, 'bank_overdraft')).toBe('current_liabilities');
    expect(sofpRow(r.statements, 'bank_overdraft')?.current).toBe(50n);
    expect(r.exceptions.map((e) => e.code)).toContain('reclassified-balance');
    expect(r.statements.sofp.totalAssets).toBe(r.statements.sofp.totalEquityAndLiabilities);
  });
  test('profit for the year flows into retained earnings in the equity statement', () => {
    const { statements: s } = ok(buildStatements(mapped(trading), opts));
    const retained = s.equity.rows.find((r) => r.id === 'closing')?.values.retained_earnings;
    expect(retained).toBe(450000_00n + trading.expectedProfit);
    expect(sofpRow(s, 'retained_earnings')?.current).toBe(retained);
  });
  test('building twice gives identical output', () => {
    const a = buildStatements(mapped(rental), opts);
    const b = buildStatements(mapped(rental), opts);
    expect(JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(
      JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
  });
});

describe('property: statements always balance', () => {
  test('any balanced mapped TB gives assets = equity + liabilities', () => {
    const amount = fc.bigInt({ min: 0n, max: 10_000_000n });
    fc.assert(
      fc.property(
        fc.record({
          ppe: amount, inventories: amount, trade_receivables: amount,
          trade_payables: amount, borrowings_nc: amount, share_capital: amount,
          revenue: amount, cost_of_sales: amount, admin_expenses: amount,
        }),
        (v) => {
          const assets = v.ppe + v.inventories + v.trade_receivables;
          const rhs = v.trade_payables + v.borrowings_nc + v.share_capital + v.revenue - v.cost_of_sales - v.admin_expenses;
          const cash = rhs - assets; // plug so the TB balances; may be negative (overdraft)
          const t = mt({ ...v, cash, retained_earnings: 0n });
          const r = buildStatements(t, opts);
          if (!r.ok) return r.blockers.every((b) => b.code === 'empty');
          return r.statements.sofp.totalAssets === r.statements.sofp.totalEquityAndLiabilities;
        },
      ),
    );
  });
});
