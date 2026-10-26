import { expect, test } from 'vitest';
import { resolveFramework, UnsupportedFrameworkError } from '../src/framework';

test('IFRS for SMEs edition is chosen by period start', () => {
  expect(resolveFramework('IFRS_SME', '2026-12-31')).toBe('IFRS_SME_2E');
  expect(resolveFramework('IFRS_SME', '2027-01-01')).toBe('IFRS_SME_3E');
  expect(resolveFramework('IFRS_SME', '2026-01-01')).toBe('IFRS_SME_2E');
});

test('full IFRS is not supported in plan 1', () => {
  expect(() => resolveFramework('FULL_IFRS', '2026-01-01')).toThrow(UnsupportedFrameworkError);
});

test('rejects an invalid date', () => {
  expect(() => resolveFramework('IFRS_SME', 'nope')).toThrow();
});
