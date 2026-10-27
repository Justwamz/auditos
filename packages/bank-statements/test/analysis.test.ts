import { describe, expect, test } from 'vitest';
import { analyse, readStatement, type Analysis, type ParsedStatement, type Txn } from '../src';
import { csvOf } from './fixtures';

const t = (date: string, amount: number, balance: number | null, description = 'x'): Txn => ({ date, description, amountCents: BigInt(amount), balanceCents: balance === null ? null : BigInt(balance) });
const statement = (transactions: Txn[], over: Partial<ParsedStatement> = {}): ParsedStatement => ({
  source: 'csv', bankName: null, accountLast4: null, periodFrom: '2026-03-01', periodTo: '2026-03-31', openingCents: 0n, closingCents: null,
  transactions, columns: {}, dateOrder: 'dmy', issues: [], ...over,
});
const standard = async (opts = {}) => analyse(await readStatement({ kind: 'csv', text: csvOf() }), opts);
const flag = (a: Analysis, code: string) => a.flags.find((f) => f.code === code);

describe('analyse: the standard statement', () => {
  test('money in and out by month, with the closing balance of each month', async () => {
    const a = await standard();
    expect(a.monthly).toEqual([{ month: '2026-03', count: 10, inCents: 122_500_000n, outCents: 114_965_050n, closingCents: 17_534_950n }]);
  });

  test('the largest entries each way, biggest first', async () => {
    const a = await standard();
    expect(a.largestOut[0]).toMatchObject({ amountCents: -110_000_000n });
    expect(a.largestIn.map((x) => x.amountCents)).toEqual([50_000_000n, 50_000_000n, 15_000_000n, 7_500_000n]);
    expect(a.largestIn.length).toBeLessThanOrEqual(5);
  });

  test('an identical entry on the same day is flagged as a possible duplicate, pointing at both rows', async () => {
    const f = flag(await standard(), 'duplicate_entries')!;
    expect(f.indexes).toEqual([4, 5]);
    expect(f.feeds).toBe('journals-trial-balance');
  });

  test('a returned cheque is flagged for going concern', async () => {
    const f = flag(await standard(), 'returned_items')!;
    expect(f.indexes).toEqual([7]);
    expect(f.feeds).toBe('going-concern');
  });

  test('large entries on a Sunday are flagged', async () => {
    const f = flag(await standard(), 'weekend_large')!;
    expect(f.indexes).toEqual([4, 5]);
  });

  test('a large payment in the last days of the period is flagged', async () => {
    const f = flag(await standard(), 'period_end_large')!;
    expect(f.indexes).toEqual([8]);
  });

  test('round-sum entries are flagged when there are several', async () => {
    const f = flag(await standard(), 'round_sums')!;
    expect(f.indexes).toEqual([1, 4, 5, 8]);
  });

  test('cash and mobile money shares are reported with their amounts', async () => {
    const a = await standard();
    expect(a.cash).toMatchObject({ inCents: 7_500_000n, outCents: 500_000n });
    expect(a.mobileMoney).toMatchObject({ inCents: 0n, outCents: 345_050n });
  });

  test('a name from the related party list appearing on the statement is flagged for the related party checklist', async () => {
    const a = await standard({ relatedParties: ['Kiprop Hardware', 'Nobody Ltd'] });
    const f = flag(a, 'related_party_names')!;
    expect(f.indexes).toEqual([8]);
    expect(f.feeds).toBe('related-parties');
    expect(f.message).toMatch(/Kiprop Hardware/);
  });

  test('without a related party list there is no such flag', async () => {
    expect(flag(await standard(), 'related_party_names')).toBeUndefined();
  });

  test('no overdraft, no flag', async () => {
    expect(flag(await standard(), 'overdrawn')).toBeUndefined();
  });
});

describe('analyse: reconciliation to the books', () => {
  test('a closing balance that equals the ledger bank balance is matched', async () => {
    const a = await standard({ ledgerBankCents: 17_534_950n });
    expect(a.reconciliation).toEqual({ statementClosingCents: 17_534_950n, ledgerCents: 17_534_950n, differenceCents: 0n, status: 'matched' });
  });

  test('a difference is shown as a reconciling item to explain, never as a conclusion', async () => {
    const a = await standard({ ledgerBankCents: 17_000_000n });
    expect(a.reconciliation).toMatchObject({ differenceCents: 534_950n, status: 'differs' });
    expect(flag(a, 'bank_reconciliation')!.feeds).toBe('journals-trial-balance');
  });

  test('with no ledger figure given there is no reconciliation', async () => {
    expect((await standard()).reconciliation).toBeNull();
  });
});

describe('analyse: edge cases', () => {
  test('days with a negative balance are counted and flagged for going concern', () => {
    const a = analyse(statement([t('2026-03-02', -5000, -5000), t('2026-03-03', -100, -5100), t('2026-03-03', -100, -5200), t('2026-03-10', 20_000, 14_800)]));
    const f = flag(a, 'overdrawn')!;
    expect(f.message).toMatch(/2 days/);
    expect(f.feeds).toBe('going-concern');
  });

  test('a statement over several months gives one line per month in order', () => {
    const a = analyse(statement([t('2026-01-31', 100, 100), t('2026-02-15', 200, 300), t('2026-02-16', -50, 250), t('2026-03-01', 10, 260)]));
    expect(a.monthly.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(a.monthly[1]).toMatchObject({ count: 2, inCents: 200n, outCents: 50n, closingCents: 250n });
  });

  test('an empty statement gives empty results, not an error', () => {
    const a = analyse(statement([]));
    expect(a.monthly).toEqual([]);
    expect(a.flags).toEqual([]);
    expect(a.largestIn).toEqual([]);
  });

  test('two round sums are not enough to call a pattern', () => {
    const a = analyse(statement([t('2026-03-02', 50_000_000, null), t('2026-03-03', -10_000_000, null), t('2026-03-04', 1234, null)]));
    expect(flag(a, 'round_sums')).toBeUndefined();
  });

  test('every flag says what it is, how serious, and where to look', async () => {
    for (const f of (await standard()).flags) {
      expect(['info', 'review', 'high']).toContain(f.severity);
      expect(f.message.length).toBeGreaterThan(20);
      expect(f.indexes.every((i) => Number.isInteger(i))).toBe(true);
    }
  });

  test('flags are signs to follow up, and the wording never accuses', async () => {
    const text = (await standard({ relatedParties: ['Kiprop Hardware'] })).flags.map((f) => f.message).join(' ');
    expect(text).not.toMatch(/fraud|fraudulent|illegal|laundering/i);
  });
});
