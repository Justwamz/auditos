import { describe, expect, test } from 'vitest';
import { formatMoney, parseMoney } from '../src/money';

describe('money', () => {
  test('parses exact decimals to cents', () => {
    expect(parseMoney('10.05')).toBe(1005n);
    expect(parseMoney('10')).toBe(1000n);
    expect(parseMoney('10.5')).toBe(1050n);
    expect(parseMoney('-5.00')).toBe(-500n);
    expect(parseMoney(' 0.07 ')).toBe(7n);
  });
  test.each(['10.005', '1e3', 'abc', '', '1,000.00', '--1', '.5', '5.'])('rejects %j', (s) => {
    expect(() => parseMoney(s)).toThrow();
  });
  test('formats cents', () => {
    expect(formatMoney(1005n)).toBe('10.05');
    expect(formatMoney(-7n)).toBe('-0.07');
    expect(formatMoney(0n)).toBe('0.00');
  });
});
