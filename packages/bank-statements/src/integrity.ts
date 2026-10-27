import type { ParsedStatement } from './types';

export interface BalanceBreak {
  index: number;
  date: string;
  description: string;
  expectedCents: bigint;
  printedCents: bigint;
}

export interface Integrity {
  /** verified: it adds up. broken: it does not, or rows were unreadable. unverified: the statement gave nothing to check against. */
  status: 'verified' | 'broken' | 'unverified';
  computedClosingCents: bigint | null;
  differenceCents: bigint | null;
  balanceBreaks: BalanceBreak[];
  totals: { count: number; inCents: bigint; outCents: bigint };
  messages: string[];
}

const kes = (c: bigint) => `KES ${(c < 0n ? -c : c) / 100n}.${((c < 0n ? -c : c) % 100n).toString().padStart(2, '0')}`;

/**
 * Has the whole statement been read? Opening balance plus the entries must equal the closing balance, and each running balance
 * must follow from the one before. A statement that fails is not silently trusted, and one with nothing to check says so.
 */
export function checkIntegrity(p: ParsedStatement): Integrity {
  const messages: string[] = [];
  let inCents = 0n;
  let outCents = 0n;
  for (const t of p.transactions) {
    if (t.amountCents >= 0n) inCents += t.amountCents;
    else outCents += -t.amountCents;
  }
  const totals = { count: p.transactions.length, inCents, outCents };
  const computed = p.openingCents === null ? null : p.openingCents + inCents - outCents;
  const difference = computed !== null && p.closingCents !== null ? p.closingCents - computed : null;

  const breaks: BalanceBreak[] = [];
  let previous = p.openingCents;
  p.transactions.forEach((t, index) => {
    if (t.balanceCents === null) return;
    if (previous !== null && previous + t.amountCents !== t.balanceCents) {
      breaks.push({ index, date: t.date, description: t.description, expectedCents: previous + t.amountCents, printedCents: t.balanceCents });
    }
    previous = t.balanceCents;
  });

  const unread = p.issues.filter((i) => i.code === 'unreadable_row' || i.code === 'direction_unknown' || i.code === 'both_columns');
  let status: Integrity['status'] = 'verified';
  if (difference !== null && difference !== 0n) {
    status = 'broken';
    messages.push(`The statement does not add up: the opening balance plus the entries gives ${kes(computed!)}, but the closing balance printed is ${kes(p.closingCents!)} (a difference of ${kes(difference)}). Entries may be missing or misread.`);
  }
  if (breaks.length > 0) {
    status = 'broken';
    messages.push(`${breaks.length} running balance${breaks.length === 1 ? '' : 's'} do not follow from the entry before. The first is on ${breaks[0]!.date}.`);
  }
  if (unread.length > 0) {
    status = 'broken';
    messages.push(`${unread.length} row${unread.length === 1 ? '' : 's'} could not be read properly and ${unread.length === 1 ? 'was' : 'were'} not counted.`);
  }
  const checkable = difference !== null || p.transactions.some((t) => t.balanceCents !== null);
  if (status === 'verified' && !checkable) {
    status = 'unverified';
    messages.push('The statement could not be checked: it prints no opening and closing balance and no running balance, so there is nothing to add the entries up against.');
  }
  return { status, computedClosingCents: computed, differenceCents: difference, balanceBreaks: breaks, totals, messages };
}
