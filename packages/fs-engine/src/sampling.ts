/**
 * Choosing what to test. Everything here is deterministic for a given seed, so a selection can be reproduced and defended:
 * the seed, the method and the population are what the schedule records.
 */
export interface PopulationItem {
  ref: string;
  description: string;
  amountCents: bigint;
}

export type SelectionReason = 'random' | 'interval' | 'key_item' | 'top';
export interface Selected {
  /** Position in the population as supplied. */
  index: number;
  reason: SelectionReason;
}

/** xmur3 string hash feeding mulberry32: small, fast, and the same everywhere. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (() => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  })();
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const abs = (c: bigint) => (c < 0n ? -c : c);

/** Simple random sample without replacement. */
export function selectRandom(items: PopulationItem[], size: number, seed: string): Selected[] {
  const n = Math.min(Math.max(0, Math.floor(size)), items.length);
  if (n === 0) return [];
  const rand = seededRandom(seed);
  const order = items.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (order.length - i));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order.slice(0, n).sort((a, b) => a - b).map((index) => ({ index, reason: 'random' as const }));
}

/**
 * Monetary-unit (value-weighted) sampling: every shilling is a unit, one is picked per interval from a random start,
 * and the item holding it is selected. An item at least as large as the interval is always hit: it is a key item.
 */
export function selectMonetaryUnit(items: PopulationItem[], size: number, seed: string): { selected: Selected[]; intervalCents: bigint } {
  const n = Math.floor(size);
  const total = items.reduce((a, i) => a + abs(i.amountCents), 0n);
  if (n <= 0 || total === 0n) return { selected: [], intervalCents: 0n };
  const interval = (total + BigInt(n) - 1n) / BigInt(n);
  const start = BigInt(Math.floor(seededRandom(seed)() * Number(interval)));
  const selected: Selected[] = [];
  let hit = start;
  let from = 0n;
  items.forEach((item, index) => {
    const size = abs(item.amountCents);
    if (size === 0n) return;
    const to = from + size;
    if (hit < to) {
      selected.push({ index, reason: size >= interval ? 'key_item' : 'interval' });
      while (hit < to) hit += interval;
    }
    from = to;
  });
  return { selected, intervalCents: interval };
}

/** The largest items by size, all tested. Ties keep population order. */
export function selectTop(items: PopulationItem[], size: number): Selected[] {
  const n = Math.min(Math.max(0, Math.floor(size)), items.length);
  return items
    .map((item, index) => ({ index, size: abs(item.amountCents) }))
    .sort((a, b) => (a.size === b.size ? a.index - b.index : a.size < b.size ? 1 : -1))
    .slice(0, n)
    .map((s) => ({ index: s.index, reason: 'top' as const }))
    .sort((a, b) => a.index - b.index);
}

export interface ProjectionInput {
  method: 'random' | 'monetary_unit' | 'top';
  populationCents: bigint;
  populationCount: number;
  tested: number;
  /** Monetary-unit interval used when the sample was drawn. */
  intervalCents?: bigint;
  exceptions: { bookCents: bigint; misstatementCents: bigint }[];
}

export interface Projection {
  exceptionCount: number;
  /** Share of tested items with an exception, one decimal place; null when nothing is tested. */
  exceptionRate: string | null;
  projectedCents: bigint | null;
  note: string;
}

const JUDGEMENT = 'This is an indication to support judgement, not a conclusion; the auditor decides what it means for the audit.';

const divRound = (num: bigint, den: bigint): bigint => {
  const n = num < 0n ? -num : num;
  const q = (2n * n + den) / (2n * den);
  return num < 0n ? -q : q;
};

/** A plain estimate of what the exceptions found might mean across the population. Never a conclusion. */
export function projectExceptions(i: ProjectionInput): Projection {
  const exceptionCount = i.exceptions.length;
  const exceptionRate = i.tested > 0 ? `${(Math.round((exceptionCount * 1000) / i.tested) / 10).toFixed(1)}%` : null;
  if (i.method === 'top') {
    return { exceptionCount, exceptionRate, projectedCents: null, note: `The largest items were tested in full and are not projected to the rest of the population. ${JUDGEMENT}` };
  }
  if (i.tested <= 0) return { exceptionCount, exceptionRate: null, projectedCents: null, note: `Nothing has been tested yet. ${JUDGEMENT}` };
  let projected = 0n;
  if (i.method === 'random') {
    const sum = i.exceptions.reduce((a, e) => a + e.misstatementCents, 0n);
    projected = divRound(sum * BigInt(i.populationCount), BigInt(i.tested));
  } else {
    for (const e of i.exceptions) {
      const book = abs(e.bookCents);
      if (book === 0n) continue;
      projected += divRound(e.misstatementCents * (i.intervalCents ?? 0n), book);
    }
  }
  return { exceptionCount, exceptionRate, projectedCents: projected, note: JUDGEMENT };
}
