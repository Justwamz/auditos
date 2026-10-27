import type { ParsedStatement, Txn } from './types';

export type FlagCode =
  | 'duplicate_entries' | 'returned_items' | 'weekend_large' | 'period_end_large' | 'round_sums'
  | 'overdrawn' | 'related_party_names' | 'bank_reconciliation' | 'cash_heavy';

export type Feeds = 'going-concern' | 'journals-trial-balance' | 'related-parties' | 'laws-regulations';

export interface Flag {
  code: FlagCode;
  severity: 'info' | 'review' | 'high';
  message: string;
  /** Positions in the statement's transactions, so the screen can show the rows. */
  indexes: number[];
  /** The checklist this observation is a prompt for. */
  feeds: Feeds;
}

export interface MonthLine { month: string; count: number; inCents: bigint; outCents: bigint; closingCents: bigint | null }
export interface Largest { index: number; date: string; description: string; amountCents: bigint }
export interface Share { inCents: bigint; outCents: bigint; count: number }
export interface Reconciliation { statementClosingCents: bigint | null; ledgerCents: bigint; differenceCents: bigint | null; status: 'matched' | 'differs' | 'unknown' }

export interface Analysis {
  monthly: MonthLine[];
  largestIn: Largest[];
  largestOut: Largest[];
  cash: Share;
  mobileMoney: Share;
  flags: Flag[];
  reconciliation: Reconciliation | null;
}

export interface AnalysisOptions {
  /** Names of related parties from the engagement, matched against descriptions. */
  relatedParties?: string[];
  /** The bank balance in the trial balance or ledger, to reconcile the closing balance to. */
  ledgerBankCents?: bigint | null;
  /** Entries at or above this are "large" for the weekend and period-end rules. Default KES 100,000. */
  largeCents?: bigint;
}

const abs = (c: bigint) => (c < 0n ? -c : c);
const kes = (c: bigint) => `KES ${(abs(c) / 100n).toLocaleString('en-KE')}`;
const CASH = /\bcash\b|\batm\b/i;
const MOBILE = /m-?pesa|airtel\s*money|\bpay\s?bill\b|\btill\b|mobile money/i;
const RETURNED = /return|dishonou?r|unpaid|bounced|refer to drawer|\brtd\b/i;
const ROUND = 100_000n; // a multiple of KES 1,000

function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

function share(txns: Txn[], test: (t: Txn) => boolean): Share {
  const s: Share = { inCents: 0n, outCents: 0n, count: 0 };
  for (const t of txns) {
    if (!test(t)) continue;
    s.count += 1;
    if (t.amountCents >= 0n) s.inCents += t.amountCents;
    else s.outCents += -t.amountCents;
  }
  return s;
}

/**
 * Observations an auditor would otherwise hunt for by eye. Every flag is a prompt to ask about, never a finding:
 * the wording says "look at" and the rules are plain, so the person can see why something was raised.
 */
export function analyse(p: ParsedStatement, opts: AnalysisOptions = {}): Analysis {
  const txns = p.transactions;
  const large = opts.largeCents ?? 10_000_000n;

  const months = new Map<string, MonthLine>();
  for (const t of txns) {
    const key = t.date.slice(0, 7);
    const m = months.get(key) ?? { month: key, count: 0, inCents: 0n, outCents: 0n, closingCents: null };
    m.count += 1;
    if (t.amountCents >= 0n) m.inCents += t.amountCents;
    else m.outCents += -t.amountCents;
    if (t.balanceCents !== null) m.closingCents = t.balanceCents;
    months.set(key, m);
  }
  const monthly = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));

  const indexed = txns.map((t, index) => ({ index, date: t.date, description: t.description, amountCents: t.amountCents }));
  const largestIn = indexed.filter((x) => x.amountCents > 0n).sort((a, b) => (a.amountCents < b.amountCents ? 1 : a.amountCents > b.amountCents ? -1 : a.index - b.index)).slice(0, 5);
  const largestOut = indexed.filter((x) => x.amountCents < 0n).sort((a, b) => (a.amountCents > b.amountCents ? 1 : a.amountCents < b.amountCents ? -1 : a.index - b.index)).slice(0, 5);

  const flags: Flag[] = [];
  const where = (idx: number[]) => idx.map((i) => txns[i]!.date).filter((d, i, a) => a.indexOf(d) === i).join(', ');

  // Identical date, description and amount more than once.
  const seen = new Map<string, number[]>();
  txns.forEach((t, i) => {
    const key = `${t.date}|${t.description.toLowerCase()}|${t.amountCents}`;
    seen.set(key, [...(seen.get(key) ?? []), i]);
  });
  const dupes = [...seen.values()].filter((v) => v.length > 1).flat().sort((a, b) => a - b);
  if (dupes.length > 0) {
    flags.push({ code: 'duplicate_entries', severity: 'review', indexes: dupes, feeds: 'journals-trial-balance',
      message: `${dupes.length} entries repeat another with the same date, description and amount (${where(dupes)}). Look at whether each is a real separate payment or a double posting.` });
  }

  const returned = txns.flatMap((t, i) => (RETURNED.test(t.description) ? [i] : []));
  if (returned.length > 0) {
    flags.push({ code: 'returned_items', severity: 'review', indexes: returned, feeds: 'going-concern',
      message: `${returned.length} entr${returned.length === 1 ? 'y looks' : 'ies look'} like a returned or dishonoured item (${where(returned)}). Look at what it was for and whether it was settled.` });
  }

  const weekend = txns.flatMap((t, i) => (abs(t.amountCents) >= large && [0, 6].includes(weekday(t.date)) ? [i] : []));
  if (weekend.length > 0) {
    flags.push({ code: 'weekend_large', severity: 'review', indexes: weekend, feeds: 'journals-trial-balance',
      message: `${weekend.length} large entr${weekend.length === 1 ? 'y is' : 'ies are'} dated on a weekend (${where(weekend)}). Banks seldom process on weekends, so look at the date the money really moved.` });
  }

  const end = p.periodTo ?? txns.at(-1)?.date ?? null;
  if (end) {
    const endMs = Date.parse(`${end}T00:00:00Z`);
    const late = txns.flatMap((t, i) => {
      const gap = (endMs - Date.parse(`${t.date}T00:00:00Z`)) / 86_400_000;
      return abs(t.amountCents) >= large * 5n && gap >= 0 && gap <= 3 ? [i] : [];
    });
    if (late.length > 0) {
      flags.push({ code: 'period_end_large', severity: 'review', indexes: late, feeds: 'journals-trial-balance',
        message: `${late.length} large entr${late.length === 1 ? 'y' : 'ies'} fall in the last three days of the period (${where(late)}). Look at cut-off: does each belong in this period?` });
    }
  }

  const round = txns.flatMap((t, i) => (abs(t.amountCents) >= large && abs(t.amountCents) % ROUND === 0n ? [i] : []));
  if (round.length >= 3) {
    flags.push({ code: 'round_sums', severity: 'info', indexes: round, feeds: 'journals-trial-balance',
      message: `${round.length} large entries are exact round sums (${kes(round.reduce((a, i) => a + abs(txns[i]!.amountCents), 0n))} in all). Round amounts are common for transfers and salaries; look at what supports them.` });
  }

  const negativeDays = new Set(txns.filter((t) => t.balanceCents !== null && t.balanceCents < 0n).map((t) => t.date));
  if (negativeDays.size > 0) {
    flags.push({ code: 'overdrawn', severity: 'review', feeds: 'going-concern',
      indexes: txns.flatMap((t, i) => (t.balanceCents !== null && t.balanceCents < 0n ? [i] : [])),
      message: `The account was overdrawn on ${negativeDays.size} day${negativeDays.size === 1 ? '' : 's'}. Look at the overdraft facility and any bank charges or breach of terms.` });
  }

  const cash = share(txns, (t) => CASH.test(t.description));
  const mobileMoney = share(txns, (t) => MOBILE.test(t.description));
  const totalIn = txns.reduce((a, t) => (t.amountCents > 0n ? a + t.amountCents : a), 0n);
  if (totalIn > 0n && cash.inCents * 100n >= totalIn * 25n) {
    flags.push({ code: 'cash_heavy', severity: 'info', feeds: 'laws-regulations', indexes: txns.flatMap((t, i) => (t.amountCents > 0n && CASH.test(t.description) ? [i] : [])),
      message: `Cash makes up ${(cash.inCents * 100n) / totalIn}% of the money in (${kes(cash.inCents)}). Look at how cash is controlled and whether the cash-transaction requirements for the firm have been considered.` });
  }

  const names = (opts.relatedParties ?? []).map((n) => n.trim()).filter((n) => n.length >= 3);
  if (names.length > 0) {
    const matched = new Set<string>();
    const idx = txns.flatMap((t, i) => {
      const hit = names.filter((n) => t.description.toLowerCase().includes(n.toLowerCase()));
      hit.forEach((h) => matched.add(h));
      return hit.length > 0 ? [i] : [];
    });
    if (idx.length > 0) {
      flags.push({ code: 'related_party_names', severity: 'review', indexes: idx, feeds: 'related-parties',
        message: `${idx.length} entr${idx.length === 1 ? 'y mentions' : 'ies mention'} a name on the related party list (${[...matched].join(', ')}). Look at whether they are disclosed and on arm's length terms.` });
    }
  }

  let reconciliation: Reconciliation | null = null;
  if (opts.ledgerBankCents !== undefined && opts.ledgerBankCents !== null) {
    const diff = p.closingCents === null ? null : p.closingCents - opts.ledgerBankCents;
    reconciliation = { statementClosingCents: p.closingCents, ledgerCents: opts.ledgerBankCents, differenceCents: diff, status: diff === null ? 'unknown' : diff === 0n ? 'matched' : 'differs' };
    if (reconciliation.status === 'differs') {
      flags.push({ code: 'bank_reconciliation', severity: 'review', indexes: [], feeds: 'journals-trial-balance',
        message: `The statement closes ${kes(diff!)} ${diff! > 0n ? 'above' : 'below'} the bank balance in the books. Look at the reconciling items (unpresented cheques, deposits in transit, errors) that explain it.` });
    }
  }

  return { monthly, largestIn, largestOut, cash, mobileMoney, flags, reconciliation };
}
