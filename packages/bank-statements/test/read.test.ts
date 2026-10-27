import ExcelJS from 'exceljs';
import { describe, expect, test } from 'vitest';
import { readStatement, StatementError } from '../src';
import { bankPdf, csvOf, imageOnlyPdf, mpesaPdf, notAPdf, ROWS } from './fixtures';

const pdf = (buf: Buffer, password?: string) => readStatement({ kind: 'pdf', data: new Uint8Array(buf), ...(password ? { password } : {}) });

/** What every layout of the standard ten entries should read as. */
function expectStandard(s: Awaited<ReturnType<typeof readStatement>>) {
  expect(s.transactions).toHaveLength(10);
  expect(s.openingCents).toBe(10_000_000n);
  expect(s.closingCents).toBe(17_534_950n);
  expect(s.transactions[0]).toMatchObject({ date: '2026-03-02', amountCents: -500_000n, balanceCents: 9_500_000n });
  expect(s.transactions[0]!.description).toContain('ATM WITHDRAWAL WESTLANDS');
  expect(s.transactions[1]).toMatchObject({ date: '2026-03-03', amountCents: 15_000_000n });
  expect(s.transactions[8]).toMatchObject({ amountCents: -110_000_000n });
  expect(s.transactions.map((t) => t.amountCents).reduce((a, b) => a + b, 0n)).toBe(17_534_950n - 10_000_000n);
  expect(s.dateOrder).toBe('dmy');
  expect(s.issues).toEqual([]);
}

describe('a text PDF from a bank', () => {
  test('is read into dated entries with the right direction, balances and the opening and closing balance', async () => {
    const s = await pdf(await bankPdf());
    expect(s.source).toBe('pdf');
    expectStandard(s);
    expect(s.accountLast4).toBe('6789');
    expect(s.periodFrom).toBe('2026-03-01');
    expect(s.periodTo).toBe('2026-03-31');
    expect(s.columns).toMatchObject({ date: 'Date', description: 'Description', debit: 'Debit', credit: 'Credit', balance: 'Balance' });
  });

  test('a description printed over two lines is one description', async () => {
    const s = await pdf(await bankPdf());
    expect(s.transactions[1]!.description).toBe('SALARY MARCH ACME TRADERS LTD');
  });

  test('the account number is never kept in full', async () => {
    const s = await pdf(await bankPdf());
    expect(JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain('0123456789');
  });

  test('a long statement over several pages, with the heading repeated, reads once, without heading rows', async () => {
    const s = await pdf(await bankPdf({ rowsPerPage: 4 }));
    expectStandard(s);
  });

  test('another bank\'s headings (Particulars, Withdrawals, Deposits)', async () => {
    const s = await pdf(await bankPdf({ headings: { date: 'Txn Date', desc: 'Particulars', out: 'Withdrawals', in: 'Deposits', bal: 'Running Balance' } }));
    expectStandard(s);
    expect(s.columns).toMatchObject({ debit: 'Withdrawals', credit: 'Deposits', description: 'Particulars' });
  });

  test('one signed Amount column reads the same', async () => {
    const s = await pdf(await bankPdf({ signedColumn: true }));
    expectStandard(s);
  });

  test('a known bank name is recognised from the heading', async () => {
    const s = await pdf(await bankPdf({ bankName: 'KCB BANK KENYA' }));
    expect(s.bankName).toBe('KCB');
  });

  test('without a closing balance line the closing balance is the last running balance', async () => {
    const s = await pdf(await bankPdf({ noClosing: true }));
    expect(s.closingCents).toBe(17_534_950n);
  });
});

describe('a mobile money statement', () => {
  test('dates with times, Paid in and Withdrawn columns, receipt numbers kept as references', async () => {
    const s = await pdf(await mpesaPdf());
    expect(s.transactions).toHaveLength(4);
    expect(s.transactions[0]).toMatchObject({ date: '2026-03-02', amountCents: -150_000n, balanceCents: 850_000n, reference: 'QCE1A2B3C4' });
    expect(s.transactions[2]).toMatchObject({ date: '2026-03-05', amountCents: 1_200_000n });
    expect(s.columns).toMatchObject({ credit: 'Paid in', debit: 'Withdrawn' });
    expect(s.transactions[0]!.description).toContain('Customer Transfer');
  });
});

describe('CSV and Excel', () => {
  test('a CSV export reads the same as the PDF', async () => {
    expectStandard(await readStatement({ kind: 'csv', text: csvOf() }));
  });

  test('semicolon-separated CSV keeps the commas inside quoted amounts', async () => {
    const semicolons = csvOf().replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ';');
    expectStandard(await readStatement({ kind: 'csv', text: semicolons }));
  });

  test('an Excel workbook reads the same, text cells included', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Statement');
    ws.addRow(['Mwangaza Traders Ltd - bank statement']);
    ws.addRow([]);
    ws.addRow(['Date', 'Description', 'Debit', 'Credit', 'Balance']);
    ws.addRow(['', 'Balance brought forward', '', '', '100,000.00']);
    for (const r of ROWS) ws.addRow([r.date, r.desc + (r.desc2 ? ` ${r.desc2}` : ''), r.out ?? '', r.in ?? '', r.bal ?? '']);
    ws.addRow(['', 'Closing balance', '', '', '175,349.50']);
    expectStandard(await readStatement({ kind: 'xlsx', data: new Uint8Array(await wb.xlsx.writeBuffer()) }));
  });

  test('numbers stored as numbers in Excel are read as amounts', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['Date', 'Narrative', 'Withdrawal', 'Deposit', 'Balance']);
    ws.addRow(['02/03/2026', 'ATM', 5000, null, 95000]);
    ws.addRow(['03/03/2026', 'Salary', null, 150000.5, 245000.5]);
    const s = await readStatement({ kind: 'xlsx', data: new Uint8Array(await wb.xlsx.writeBuffer()) });
    expect(s.transactions.map((t) => t.amountCents)).toEqual([-500_000n, 15_000_050n]);
  });
});

describe('dates', () => {
  test('month-first dates are recognised when a date proves it', async () => {
    const s = await readStatement({ kind: 'csv', text: 'Date,Description,Debit,Credit,Balance\n03/13/2026,Test,10.00,,90.00\n03/14/2026,Test 2,,5.00,95.00' });
    expect(s.dateOrder).toBe('mdy');
    expect(s.transactions[0]!.date).toBe('2026-03-13');
  });

  test('a row with no readable date is reported, not dropped silently', async () => {
    const s = await readStatement({ kind: 'csv', text: 'Date,Description,Debit,Credit,Balance\n02/03/2026,Good,10.00,,90.00\nnot a date,Odd row,25.00,,65.00' });
    expect(s.transactions).toHaveLength(1);
    expect(s.issues.map((i) => i.code)).toContain('unreadable_row');
  });
});

describe('direction', () => {
  test('an unsigned single Amount column takes its direction from the running balance', async () => {
    const s = await readStatement({ kind: 'csv', text: 'Date,Description,Amount,Balance\n,Balance brought forward,,100.00\n02/03/2026,Paid out,10.00,90.00\n03/03/2026,Paid in,50.00,140.00' });
    expect(s.transactions.map((t) => t.amountCents)).toEqual([-1000n, 5000n]);
  });

  test('with neither a sign nor a balance the direction cannot be known and that is said', async () => {
    const s = await readStatement({ kind: 'csv', text: 'Date,Description,Amount\n02/03/2026,Something,10.00' });
    expect(s.issues.map((i) => i.code)).toContain('direction_unknown');
  });

  test('Dr and Cr markers on a single column are honoured', async () => {
    const s = await readStatement({ kind: 'csv', text: 'Date,Description,Amount\n02/03/2026,Out,10.00 Dr\n03/03/2026,In,50.00 Cr' });
    expect(s.transactions.map((t) => t.amountCents)).toEqual([-1000n, 5000n]);
  });

  test('a balance printed with Dr means overdrawn', async () => {
    const s = await readStatement({ kind: 'csv', text: 'Date,Description,Debit,Credit,Balance\n02/03/2026,Cheque,500.00,,200.00 Dr' });
    expect(s.transactions[0]!.balanceCents).toBe(-20_000n);
  });
});

describe('what is refused, and why', () => {
  test('a password-protected PDF needs its password, and a wrong one is refused', async () => {
    const buf = await bankPdf({ password: 'secret-pass' });
    await expect(pdf(buf)).rejects.toMatchObject({ code: 'password_required' });
    await expect(pdf(buf, 'wrong')).rejects.toMatchObject({ code: 'password_incorrect' });
    expectStandard(await pdf(buf, 'secret-pass'));
  });

  test('a scanned (image-only) PDF is refused', async () => {
    await expect(pdf(await imageOnlyPdf())).rejects.toMatchObject({ code: 'scanned_pdf' });
  });

  test('a file that is not a PDF is refused, whatever it is called', async () => {
    await expect(readStatement({ kind: 'pdf', data: notAPdf() })).rejects.toMatchObject({ code: 'not_a_pdf' });
  });

  test('a document with no statement table is refused', async () => {
    await expect(readStatement({ kind: 'csv', text: 'Hello,World\n1,2' })).rejects.toMatchObject({ code: 'no_table_found' });
    await expect(readStatement({ kind: 'csv', text: '' })).rejects.toBeInstanceOf(StatementError);
  });

  test('an enormous statement is refused', async () => {
    const rows = Array.from({ length: 20_001 }, (_, i) => `02/03/2026,Row ${i},1.00,,100.00`);
    await expect(readStatement({ kind: 'csv', text: ['Date,Description,Debit,Credit,Balance', ...rows].join('\n') })).rejects.toMatchObject({ code: 'too_many_rows' });
  });

  test('refusals carry a message a person can act on', async () => {
    const err = await pdf(await bankPdf({ password: 'x' })).catch((e: StatementError) => e);
    expect((err as StatementError).message).toMatch(/password/i);
  });

  test('the password never appears in the result', async () => {
    const s = await pdf(await bankPdf({ password: 'very-secret-1' }), 'very-secret-1');
    expect(JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain('very-secret-1');
  });
});

