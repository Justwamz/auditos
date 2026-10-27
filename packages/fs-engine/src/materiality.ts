import { formatMoney, parseMoney } from './money';

export const BENCHMARKS = ['revenue', 'total_assets', 'profit_before_tax', 'total_expenses', 'equity'] as const;
export type Benchmark = (typeof BENCHMARKS)[number];

export interface MaterialityInput {
  benchmark: Benchmark;
  amount: string;
  percent: number;
  performancePercent?: number;
  trivialPercent?: number;
}
export interface MaterialityResult {
  overall: string;
  performance: string;
  trivial: string;
}

/** Percentages are kept in hundredths of a percent so the arithmetic stays exact. */
function basisPoints(label: string, value: number, max: number): bigint {
  const bp = Math.round(value * 100);
  if (!Number.isFinite(value) || value <= 0 || value > max || Math.abs(bp - value * 100) > 1e-6) {
    throw new RangeError(`${label} must be above 0 and at most ${max}, with at most two decimals`);
  }
  return BigInt(bp);
}

/** Overall, performance and clearly trivial amounts in KES, rounded down to whole cents. */
export function computeMateriality(input: MaterialityInput): MaterialityResult {
  let cents: bigint;
  try {
    cents = parseMoney(input.amount);
  } catch {
    throw new RangeError('The benchmark amount is not a valid amount');
  }
  if (cents <= 0n) throw new RangeError('The benchmark amount must be above zero');
  const overall = (cents * basisPoints('Percentage', input.percent, 20)) / 10000n;
  const performance = (overall * basisPoints('Performance percentage', input.performancePercent ?? 75, 100)) / 10000n;
  const trivial = (overall * basisPoints('Clearly trivial percentage', input.trivialPercent ?? 5, 10)) / 10000n;
  return { overall: formatMoney(overall), performance: formatMoney(performance), trivial: formatMoney(trivial) };
}
