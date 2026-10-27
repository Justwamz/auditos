import { describe, expect, test } from 'vitest';
import { parseAmount, parseDate } from '../src/values';

describe('parseAmount', () => {
  test.each([
    ['1,234.56', 123456n, null],
    ['1234.56', 123456n, null],
    ['1234', 123400n, null],
    ['0.50', 50n, null],
    ['.5', 50n, null],
    ['1,234,567.89', 123456789n, null],
    ['KES 1,234.56', 123456n, null],
    ['Ksh. 2,000', 200000n, null],
    ['1,234.56 Dr', 123456n, 'dr'],
    ['1,234.56 CR', 123456n, 'cr'],
    ['1,234.56DR', 123456n, 'dr'],
    ['  500.00  ', 50000n, null],
  ])('%s is %s cents, side %s', (text, cents, side) => {
    expect(parseAmount(text)).toEqual({ cents, side });
  });

  test('brackets and minus signs mean the amount is negative', () => {
    expect(parseAmount('(1,234.56)')).toEqual({ cents: -123456n, side: null });
    expect(parseAmount('-1,234.56')).toEqual({ cents: -123456n, side: null });
    expect(parseAmount('1,234.56-')).toEqual({ cents: -123456n, side: null });
    expect(parseAmount('−500.00')).toEqual({ cents: -50000n, side: null });
  });

  test('more than two decimals is refused rather than rounded', () => {
    expect(parseAmount('1,234.567')).toBeNull();
  });

  test.each(['', '   ', 'abc', 'Balance', '12/03/2026', '1.2.3', '--5', '1,23,4.00x', 'N/A', '12 345'])('%j is not an amount', (text) => {
    expect(parseAmount(text)).toBeNull();
  });

  test('very large amounts stay exact', () => {
    expect(parseAmount('9,999,999,999,999.99')).toEqual({ cents: 999999999999999n, side: null });
  });
});

describe('parseDate', () => {
  test.each([
    ['02/03/2026', '2026-03-02'],
    ['2/3/2026', '2026-03-02'],
    ['02-03-2026', '2026-03-02'],
    ['02.03.2026', '2026-03-02'],
    ['02/03/26', '2026-03-02'],
    ['2026-03-02', '2026-03-02'],
    ['2026/03/02', '2026-03-02'],
    ['02 Mar 2026', '2026-03-02'],
    ['2 March 2026', '2026-03-02'],
    ['02-Mar-2026', '2026-03-02'],
    ['02-MAR-26', '2026-03-02'],
    ['Mar 2, 2026', '2026-03-02'],
    ['2026-03-02 14:35:10', '2026-03-02'],
    ['02/03/2026 14:35', '2026-03-02'],
    ['31/12/2026', '2026-12-31'],
    ['29/02/2028', '2028-02-29'],
  ])('%s is %s', (text, iso) => {
    expect(parseDate(text)).toBe(iso);
  });

  test('day-first by default; month-first when asked', () => {
    expect(parseDate('03/02/2026')).toBe('2026-02-03');
    expect(parseDate('03/02/2026', 'mdy')).toBe('2026-03-02');
    expect(parseDate('13/02/2026', 'mdy')).toBeNull();
  });

  test.each(['', 'yesterday', '31/02/2026', '29/02/2027', '00/01/2026', '32/01/2026', '12/13/2026', '2026-13-01', '12345', '1/1', 'Balance b/f'])('%j is not a date', (text) => {
    expect(parseDate(text)).toBeNull();
  });
});
