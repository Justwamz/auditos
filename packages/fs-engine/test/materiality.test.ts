import { describe, expect, test } from 'vitest';
import { computeMateriality } from '../src';

describe('computeMateriality', () => {
  test('1% of KES 120,000,000 revenue, with the default 75% performance and 5% trivial thresholds', () => {
    expect(computeMateriality({ benchmark: 'revenue', amount: '120000000.00', percent: 1 })).toEqual({
      overall: '1200000.00', performance: '900000.00', trivial: '60000.00',
    });
  });
  test('uses the percentages given, including decimals', () => {
    const r = computeMateriality({ benchmark: 'total_assets', amount: '50000000', percent: 0.5, performancePercent: 60, trivialPercent: 3 });
    expect(r).toEqual({ overall: '250000.00', performance: '150000.00', trivial: '7500.00' });
  });
  test('rounds down to whole cents, never up', () => {
    expect(computeMateriality({ benchmark: 'revenue', amount: '100.01', percent: 1 }).overall).toBe('1.00');
  });
  test.each([
    ['negative amount', { amount: '-5', percent: 1 }],
    ['zero amount', { amount: '0', percent: 1 }],
    ['non-numeric amount', { amount: 'abc', percent: 1 }],
    ['zero percent', { amount: '100', percent: 0 }],
    ['percent above 20', { amount: '100', percent: 21 }],
    ['performance percent above 100', { amount: '100', percent: 1, performancePercent: 101 }],
    ['trivial percent above 10', { amount: '100', percent: 1, trivialPercent: 11 }],
    ['percent with more than two decimals', { amount: '100', percent: 1.234 }],
  ])('rejects %s', (_name, input) => {
    expect(() => computeMateriality({ benchmark: 'revenue', ...input })).toThrow(RangeError);
  });
});
