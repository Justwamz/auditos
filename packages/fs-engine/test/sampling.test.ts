import { describe, expect, test } from 'vitest';
import { projectExceptions, selectMonetaryUnit, selectRandom, selectTop, seededRandom, type PopulationItem } from '../src';

const pop = (amounts: number[]): PopulationItem[] => amounts.map((a, i) => ({ ref: `INV-${i + 1}`, description: `Item ${i + 1}`, amountCents: BigInt(a) }));

describe('seededRandom', () => {
  test('the same seed always gives the same sequence, a different seed gives another', () => {
    const a = seededRandom('audit-2026'), b = seededRandom('audit-2026'), c = seededRandom('other');
    const run = (r: () => number) => Array.from({ length: 5 }, r);
    expect(run(a)).toEqual(run(b));
    expect(run(seededRandom('audit-2026'))).not.toEqual(run(c));
  });
  test('values are in [0, 1)', () => {
    const r = seededRandom('x');
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('selectRandom', () => {
  const items = pop(Array.from({ length: 200 }, (_, i) => (i + 1) * 100));
  test('picks the requested number, each once, in population order, and repeats for the same seed', () => {
    const a = selectRandom(items, 25, 'seed-1');
    expect(a).toHaveLength(25);
    expect(new Set(a.map((s) => s.index)).size).toBe(25);
    expect(a.map((s) => s.index)).toEqual([...a.map((s) => s.index)].sort((x, y) => x - y));
    expect(selectRandom(items, 25, 'seed-1')).toEqual(a);
    expect(selectRandom(items, 25, 'seed-2').map((s) => s.index)).not.toEqual(a.map((s) => s.index));
    expect(a.every((s) => s.reason === 'random')).toBe(true);
  });
  test('asking for more than the population takes everything', () => {
    expect(selectRandom(pop([1, 2, 3]), 10, 's')).toHaveLength(3);
  });
  test('an empty population or a size of zero selects nothing', () => {
    expect(selectRandom([], 5, 's')).toEqual([]);
    expect(selectRandom(pop([1, 2]), 0, 's')).toEqual([]);
  });
});

describe('selectMonetaryUnit', () => {
  test('larger items are more likely; one bigger than the interval is always taken, as a key item', () => {
    const items = pop([1_000, 2_000, 50_000, 3_000, 1_500, 2_500]); // total 60,000
    const r = selectMonetaryUnit(items, 4, 'mus');
    expect(r.intervalCents).toBe(15_000n);
    expect(r.selected.find((s) => s.index === 2)?.reason).toBe('key_item');
    expect(r.selected.length).toBeLessThanOrEqual(4);
    expect(new Set(r.selected.map((s) => s.index)).size).toBe(r.selected.length);
  });
  test('the same seed repeats the selection', () => {
    const items = pop(Array.from({ length: 100 }, (_, i) => 1000 + i * 37));
    expect(selectMonetaryUnit(items, 10, 'a')).toEqual(selectMonetaryUnit(items, 10, 'a'));
  });
  test('a population where every item is small relative to the interval gives about the requested number', () => {
    const items = pop(Array.from({ length: 1000 }, () => 1000));
    const r = selectMonetaryUnit(items, 40, 'z');
    expect(r.selected).toHaveLength(40);
    expect(r.selected.every((s) => s.reason === 'interval')).toBe(true);
  });
  test('credits and debits both count by their size, and zero-value items are never picked', () => {
    const r = selectMonetaryUnit(pop([0, -5_000, 5_000, 0, 10_000]), 3, 'q');
    expect(r.selected.every((s) => s.index !== 0 && s.index !== 3)).toBe(true);
    expect(r.intervalCents).toBe(6_667n);
  });
  test('an empty or all-zero population selects nothing', () => {
    expect(selectMonetaryUnit([], 5, 's').selected).toEqual([]);
    expect(selectMonetaryUnit(pop([0, 0]), 5, 's').selected).toEqual([]);
  });
});

describe('selectTop', () => {
  test('takes the largest items by size, ties by position', () => {
    const r = selectTop(pop([5, -90, 40, 90, 10]), 3);
    expect(r.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(r.every((s) => s.reason === 'top')).toBe(true);
  });
});

describe('projectExceptions', () => {
  test('no exceptions gives a zero rate and no projected amount', () => {
    const r = projectExceptions({ method: 'random', populationCents: 1_000_000n, populationCount: 100, tested: 20, exceptions: [] });
    expect(r).toMatchObject({ exceptionCount: 0, exceptionRate: '0.0%', projectedCents: 0n });
  });
  test('random sampling scales the average misstatement in the items tested up to the whole population count', () => {
    const r = projectExceptions({ method: 'random', populationCents: 1_000_000n, populationCount: 100, tested: 20, exceptions: [{ bookCents: 10_000n, misstatementCents: 500n }, { bookCents: 20_000n, misstatementCents: 1_500n }] });
    expect(r.exceptionCount).toBe(2);
    expect(r.exceptionRate).toBe('10.0%');
    expect(r.projectedCents).toBe(10_000n); // 2,000 over 20 tested, times 100 items
  });
  test('monetary-unit sampling scales each exception by its tainting and the interval', () => {
    const r = projectExceptions({ method: 'monetary_unit', populationCents: 6_000_000n, populationCount: 100, tested: 4, intervalCents: 1_500_000n, exceptions: [{ bookCents: 100_000n, misstatementCents: 10_000n }] });
    expect(r.projectedCents).toBe(150_000n); // 10% tainting x 1,500,000 interval
  });
  test('top items are not projected, because they are not a sample of the rest', () => {
    const r = projectExceptions({ method: 'top', populationCents: 1_000_000n, populationCount: 100, tested: 10, exceptions: [{ bookCents: 100n, misstatementCents: 50n }] });
    expect(r.projectedCents).toBeNull();
    expect(r.note).toMatch(/not projected/i);
  });
  test('the result is a prompt for judgement and says so', () => {
    const r = projectExceptions({ method: 'random', populationCents: 1n, populationCount: 1, tested: 1, exceptions: [] });
    expect(r.note).toMatch(/judgement|judgment/i);
  });
  test('nothing tested gives no rate rather than dividing by zero', () => {
    const r = projectExceptions({ method: 'random', populationCents: 100n, populationCount: 5, tested: 0, exceptions: [] });
    expect(r.exceptionRate).toBeNull();
    expect(r.projectedCents).toBeNull();
  });
});
