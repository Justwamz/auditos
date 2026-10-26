import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { MappedTb } from '../src/mapping';
import { buildStatements } from '../src/statements';
import { buildCashFlowIndirect } from '../src/cashflow';

const mt = (lines: Record<string, bigint>): MappedTb => ({
  lines: new Map(Object.entries(lines)),
  unmapped: [],
  totalDebit: 0n,
  totalCredit: 0n,
  balanced: true,
  empty: false,
});
const opts = { periodStart: '2026-01-01', periodEnd: '2026-12-31', framework: 'IFRS_SME' as const };

const prior = mt({
  cash: 100n, inventories: 50n, ppe: 200n, trade_payables: 60n, share_capital: 100n, retained_earnings: 190n,
});
// prior has no P&L lines, so its closing retained earnings stay 190.
const current = mt({
  cash: 130n, inventories: 80n, ppe: 220n, trade_payables: 70n, share_capital: 100n, retained_earnings: 190n,
  revenue: 300n, cost_of_sales: 150n, admin_expenses: 50n, depreciation: 30n,
});

describe('cash flow (indirect)', () => {
  test('without comparatives the statement is omitted with a no-comparatives exception', () => {
    const r = buildCashFlowIndirect(current, undefined);
    expect(r.statement).toBeUndefined();
    expect(r.exceptions.map((e) => e.code)).toContain('no-comparatives');
  });
  test('net movement equals the change in cash and equivalents', () => {
    const r = buildCashFlowIndirect(current, prior);
    expect(r.statement!.closingCash - r.statement!.openingCash).toBe(30n);
    expect(r.statement?.netMovement).toBe(30n);
    expect(r.exceptions).toEqual([]);
  });
  test('is wired into buildStatements when a prior year exists', () => {
    const r = buildStatements(current, { ...opts, prior });
    expect(r.ok && r.statements.cashflow?.netMovement).toBe(30n);
  });
  test('a retained-earnings roll-forward break is reported', () => {
    const broken = mt({ ...Object.fromEntries(current.lines), retained_earnings: 195n });
    const r = buildCashFlowIndirect(broken, prior);
    expect(r.exceptions.map((e) => e.code)).toContain('retained-earnings-rollforward');
  });
  test('property: net movement always equals change in cash when equity rolls forward', () => {
    const n = fc.bigInt({ min: 0n, max: 1_000_000n });
    fc.assert(
      fc.property(
        fc.record({
          pInv: n, pPpe: n, pPay: n, pCap: n, pRe: n,
          cInv: n, cPpe: n, cPay: n, cCap: n, cRev: n, cCos: n, cDep: n, cDiv: n, cBorrow: n,
        }),
        (v) => {
          const pl = (v.pCap + v.pRe + v.pPay) - (v.pInv + v.pPpe);
          const p = mt({ cash: pl, inventories: v.pInv, ppe: v.pPpe, trade_payables: v.pPay, share_capital: v.pCap, retained_earnings: v.pRe });
          const profit = v.cRev - v.cCos - v.cDep;
          const closingRe = v.pRe - v.cDiv + 0n; // prior had no P&L, so opening = prior closing
          const equityC = v.cCap + closingRe + profit;
          const cashC = equityC + v.cPay + v.cBorrow - v.cInv - v.cPpe;
          const c = mt({
            cash: cashC, inventories: v.cInv, ppe: v.cPpe, trade_payables: v.cPay, share_capital: v.cCap,
            retained_earnings: v.pRe, revenue: v.cRev, cost_of_sales: v.cCos, depreciation: v.cDep,
            dividends: v.cDiv, borrowings_nc: v.cBorrow,
          });
          const r = buildCashFlowIndirect(c, p);
          const s = r.statement!;
          return s.netMovement === s.closingCash - s.openingCash;
        },
      ),
    );
  });
});
