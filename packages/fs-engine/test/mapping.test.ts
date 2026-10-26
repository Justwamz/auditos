import { describe, expect, test } from 'vitest';
import { mapTrialBalance, suggestMapping, type TbLine } from '../src/mapping';

const tb = (code: string, name: string, d: bigint, c: bigint): TbLine => ({ code, name, debit: d, credit: c });

describe('mapTrialBalance', () => {
  test('sums natural-sign values per line and checks balance', () => {
    const lines = [tb('1000', 'Cash at bank', 500n, 0n), tb('3000', 'Share capital', 0n, 500n)];
    const m = mapTrialBalance(lines, { '1000': 'cash', '3000': 'share_capital' });
    expect(m.lines.get('cash')).toBe(500n);
    expect(m.lines.get('share_capital')).toBe(500n);
    expect(m.balanced).toBe(true);
    expect(m.unmapped).toEqual([]);
  });
  test('unbalanced TB reports balanced=false', () => {
    const m = mapTrialBalance([tb('1', 'Cash', 100n, 0n)], { '1': 'cash' });
    expect(m.balanced).toBe(false);
    expect(m.totalDebit - m.totalCredit).toBe(100n);
  });
  test('unmapped accounts are returned, not dropped', () => {
    const l = tb('9', 'Mystery', 5n, 0n);
    const m = mapTrialBalance([l], {});
    expect(m.unmapped).toEqual([l]);
    expect(m.totalDebit).toBe(5n);
  });
  test('mapping to an unknown line id counts as unmapped', () => {
    const l = tb('9', 'X', 5n, 0n);
    expect(mapTrialBalance([l], { '9': 'not_a_line' }).unmapped).toEqual([l]);
  });
  test('credit-normal line gets credit minus debit (a debit balance goes negative)', () => {
    const m = mapTrialBalance([tb('7', 'Revenue', 30n, 0n)], { '7': 'revenue' });
    expect(m.lines.get('revenue')).toBe(-30n);
  });
  test('empty TB is balanced with no lines and flagged empty', () => {
    const m = mapTrialBalance([], {});
    expect(m.balanced).toBe(true);
    expect(m.lines.size).toBe(0);
    expect(m.empty).toBe(true);
  });
  test('all-zero TB is flagged empty', () => {
    expect(mapTrialBalance([tb('1', 'Cash', 0n, 0n)], { '1': 'cash' }).empty).toBe(true);
  });
});

describe('suggestMapping', () => {
  test('keyword suggestions', () => {
    const s = suggestMapping([tb('1', 'Stock - goods for resale', 1n, 0n), tb('2', 'Rental income', 0n, 1n), tb('3', 'Trade debtors', 1n, 0n)]);
    expect(s['1']).toBe('inventories');
    expect(s['2']).toBe('rental_income');
    expect(s['3']).toBe('trade_receivables');
  });
  test('prior mapping wins over suggestions', () => {
    const s = suggestMapping([tb('1', 'Stock', 1n, 0n)], { '1': 'other_nca' });
    expect(s['1']).toBe('other_nca');
  });
  test('unknown names get no suggestion', () => {
    expect(suggestMapping([tb('1', 'Zzz', 1n, 0n)])['1']).toBeUndefined();
  });
});
