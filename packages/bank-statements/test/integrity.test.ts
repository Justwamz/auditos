import { describe, expect, test } from 'vitest';
import { checkIntegrity, readStatement, type ParsedStatement, type Txn } from '../src';
import { csvOf, ROWS } from './fixtures';

const t = (date: string, amount: number, balance: number | null, description = 'x'): Txn => ({ date, description, amountCents: BigInt(amount), balanceCents: balance === null ? null : BigInt(balance) });
const statement = (over: Partial<ParsedStatement>): ParsedStatement => ({
  source: 'csv', bankName: null, accountLast4: null, periodFrom: null, periodTo: null, openingCents: 10_000n, closingCents: 11_500n,
  transactions: [t('2026-03-01', 2000, 12_000), t('2026-03-02', -500, 11_500)], columns: {}, dateOrder: 'dmy', issues: [], ...over,
});

describe('checkIntegrity', () => {
  test('opening plus the entries equals the closing balance, and every running balance follows: verified', () => {
    const r = checkIntegrity(statement({}));
    expect(r).toMatchObject({ status: 'verified', differenceCents: 0n, computedClosingCents: 11_500n, balanceBreaks: [], totals: { count: 2, inCents: 2000n, outCents: 500n } });
  });

  test('the standard ten-entry statement is verified end to end', async () => {
    const r = checkIntegrity(await readStatement({ kind: 'csv', text: csvOf() }));
    expect(r.status).toBe('verified');
    expect(r.totals.count).toBe(10);
  });

  test('a missing entry is caught by the difference, with the amount that is missing', () => {
    const r = checkIntegrity(statement({ transactions: [t('2026-03-01', 2000, 12_000)], closingCents: 11_500n }));
    expect(r.status).toBe('broken');
    expect(r.differenceCents).toBe(-500n);
    expect(r.messages.join(' ')).toMatch(/does not add up/i);
  });

  test('a running balance that does not follow shows where the statement breaks', () => {
    const r = checkIntegrity(statement({ transactions: [t('2026-03-01', 2000, 12_000), t('2026-03-02', -500, 11_900)] }));
    expect(r.status).toBe('broken');
    expect(r.balanceBreaks).toEqual([{ index: 1, date: '2026-03-02', description: 'x', expectedCents: 11_500n, printedCents: 11_900n }]);
  });

  test('a debit read as a credit is caught, and only that row is reported', () => {
    const rows = ROWS.map((r) => ({ ...r }));
    const text = csvOf(rows).replace('"5,000.00",""', '"","5,000.00"');
    return readStatement({ kind: 'csv', text }).then((p) => {
      const r = checkIntegrity(p);
      expect(r.status).toBe('broken');
      expect(r.balanceBreaks.length).toBeGreaterThan(0);
      expect(r.balanceBreaks[0]!.index).toBe(0);
    });
  });

  test('a statement with no balances at all cannot be verified and says so', () => {
    const r = checkIntegrity(statement({ openingCents: null, closingCents: null, transactions: [t('2026-03-01', 2000, null), t('2026-03-02', -500, null)] }));
    expect(r.status).toBe('unverified');
    expect(r.messages.join(' ')).toMatch(/could not be checked/i);
  });

  test('rows that could not be read make it broken even if the rest adds up', () => {
    const r = checkIntegrity(statement({ issues: [{ code: 'unreadable_row', message: 'A row with an amount has no readable date', line: '??? 10.00' }] }));
    expect(r.status).toBe('broken');
    expect(r.messages.join(' ')).toMatch(/could not be read/i);
  });

  test('opening only: a closing balance worked from the entries is offered, not trusted', () => {
    const r = checkIntegrity(statement({ closingCents: null, transactions: [t('2026-03-01', 2000, null), t('2026-03-02', -500, null)] }));
    expect(r.status).toBe('unverified');
    expect(r.computedClosingCents).toBe(11_500n);
  });

  test('totals count money in and out separately', () => {
    const r = checkIntegrity(statement({ transactions: [t('2026-03-01', 5000, null), t('2026-03-02', -1200, null), t('2026-03-03', -300, null)], closingCents: null, openingCents: 0n }));
    expect(r.totals).toEqual({ count: 3, inCents: 5000n, outCents: 1500n });
  });
});
