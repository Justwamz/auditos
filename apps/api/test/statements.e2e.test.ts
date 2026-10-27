import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { bankPdf, csvOf, imageOnlyPdf, ROWS } from '../../../packages/bank-statements/test/fixtures';
import { harness, login, makeTenant, makeUser, multipartBody, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P2: TestUser, P: TestUser, M: TestUser, F: TestUser, OS: TestUser, M2: TestUser;
let sP2: Session, sP: Session, sM: Session, sF: Session, sOS: Session, sM2: Session;
let eng: string;

type Method = 'GET' | 'POST' | 'DELETE';
const call = (s: Session, method: Method, url: string, payload?: object) => h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const upload = (s: Session, filename: string, data: Buffer, fields: Record<string, string> = {}) => {
  const m = multipartBody(filename, data, fields);
  return h.app.inject({ method: 'POST', url: `/engagements/${eng}/bank-statements`, headers: { ...s.headers, 'content-type': m.contentType }, payload: m.payload });
};
const csvBuf = (text = csvOf()) => Buffer.from(text, 'utf8');
const trail = async (s: Session) => (await call(s, 'GET', '/audit-trail?limit=100')).json().events as { sentence: string; action: string }[];

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'statements');
  P = await makeUser(h, T.id, 'partner', 4);
  P2 = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  M2 = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  OS = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sP2 = await login(h, P2);
  sM = await login(h, M);
  sM2 = await login(h, M2);
  sF = await login(h, F);
  sOS = await login(h, OS);
  for (const s of [sP, sP2, sM, sM2, sF, sOS]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  const client = (await call(sM, 'POST', '/clients', { name: 'Mwangaza Traders Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  eng = (await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${eng}/members`, { userId: F.id });
});
afterAll(async () => h.close());

describe('uploading a statement', () => {
  test('a team member uploads a CSV and gets a preview with the checks; nothing is analysed yet', async () => {
    const r = await upload(sF, 'march.csv', csvBuf());
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b).toMatchObject({ source: 'csv', transactionCount: 10, opening: '100000.00', closing: '175349.50', integrity: { status: 'verified' }, totals: { in: '1225000.00', out: '1149650.50' } });
    expect(b.preview).toHaveLength(10);
    expect((await call(sF, 'GET', `/engagements/${eng}/bank-statements/${b.id}/analysis`)).statusCode).toBe(409);
  });

  test('the entries are stored encrypted and the account number is never stored in full', async () => {
    const rows = (await ownerQuery(h, T.id, 'select content_enc, account_last4, filename from bank_statements where engagement_id = $1', [eng], F.id)).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.content_enc).toMatch(/^v1\./);
      expect(row.content_enc).not.toContain('SALARY');
      expect(JSON.stringify(row)).not.toContain('0123456789');
    }
  });

  test('a password-protected PDF asks for its password, refuses a wrong one, and the password is not kept', async () => {
    const pdf = await bankPdf({ password: 'secret-pass-77' });
    const need = await upload(sF, 'locked.pdf', pdf);
    expect(need.statusCode).toBe(422);
    expect(need.json().error).toBe('password_required');
    const wrong = await upload(sF, 'locked.pdf', pdf, { password: 'nope' });
    expect(wrong.json().error).toBe('password_incorrect');
    const ok = await upload(sF, 'locked.pdf', pdf, { password: 'secret-pass-77' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ source: 'pdf', accountLast4: '6789', integrity: { status: 'verified' } });
    const dump = (await ownerQuery(h, T.id, 'select to_jsonb(s)::text as t from bank_statements s', [], F.id)).rows.map((r) => r.t).join(' ');
    const events = (await ownerQuery(h, T.id, 'select detail::text as t from audit_events')).rows.map((r) => r.t).join(' ');
    expect(dump + events).not.toContain('secret-pass-77');
  });

  test('a scanned PDF, a fake PDF and an unsupported type are each refused with a reason', async () => {
    const scanned = await upload(sF, 'scan.pdf', await imageOnlyPdf());
    expect([scanned.statusCode, scanned.json().error]).toEqual([422, 'scanned_pdf']);
    expect(scanned.json().message).toMatch(/no readable text/i);
    const fake = await upload(sF, 'fake.pdf', Buffer.from('not really a pdf'));
    expect([fake.statusCode, fake.json().error]).toEqual([415, 'not_a_pdf']);
    const exe = await upload(sF, 'run.exe', Buffer.from('MZ'));
    expect([exe.statusCode, exe.json().error]).toEqual([415, 'unsupported_type']);
  });

  test('someone not on the engagement team cannot upload, even a partner or another manager', async () => {
    expect((await upload(sOS, 'march.csv', csvBuf())).statusCode).toBe(404);
    expect((await upload(sM2, 'march.csv', csvBuf())).statusCode).toBe(404);
    expect((await upload(sP2, 'march.csv', csvBuf())).statusCode).toBe(404);
  });
});

describe('a statement that does not add up', () => {
  let id: string;
  test('is flagged, and confirming it needs a reason that stays on the record', async () => {
    const missing = csvOf(ROWS.filter((r) => r.desc !== 'BANK CHARGES'));
    const r = await upload(sF, 'march-missing-row.csv', csvBuf(missing));
    expect(r.statusCode).toBe(201);
    id = r.json().id;
    expect(r.json().integrity.status).toBe('broken');
    expect(r.json().integrity.messages.join(' ')).toMatch(/does not add up/i);
    expect(r.json().integrity.difference).toBe('-1200.00');
    expect((await call(sF, 'POST', `/engagements/${eng}/bank-statements/${id}/confirm`, {})).statusCode).toBe(422);
    const ok = await call(sF, 'POST', `/engagements/${eng}/bank-statements/${id}/confirm`, { reason: 'The last page of the statement is missing; client to resend' });
    expect(ok.statusCode).toBe(200);
    const list = (await call(sF, 'GET', `/engagements/${eng}/bank-statements`)).json().statements as { id: string; confirmed: boolean; acknowledgedReason: string }[];
    expect(list.find((s) => s.id === id)).toMatchObject({ confirmed: true, acknowledgedReason: 'The last page of the statement is missing; client to resend' });
    expect((await trail(sM)).map((e) => e.sentence).join('\n')).toMatch(/accepted the bank statement "march-missing-row.csv".*does not fully add up. Reason given: "The last page/);
  });
});

describe('confirming and analysing', () => {
  let id: string;
  test('a statement that adds up is confirmed with no reason, then analysed', async () => {
    id = (await upload(sF, 'march-good.csv', csvBuf())).json().id;
    expect((await call(sF, 'POST', `/engagements/${eng}/bank-statements/${id}/confirm`, {})).statusCode).toBe(200);
    const a = await call(sF, 'GET', `/engagements/${eng}/bank-statements/${id}/analysis?ledger=${encodeURIComponent('170,000.00')}&parties=${encodeURIComponent('Kiprop Hardware, Nobody Ltd')}`);
    expect(a.statusCode).toBe(200);
    const b = a.json();
    expect(b.monthly[0]).toMatchObject({ month: '2026-03', in: '1225000.00', out: '1149650.50', closing: '175349.50' });
    const codes = b.flags.map((f: { code: string }) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['duplicate_entries', 'returned_items', 'weekend_large', 'period_end_large', 'round_sums', 'related_party_names', 'bank_reconciliation']));
    expect(b.reconciliation).toMatchObject({ statementClosing: '175349.50', ledger: '170000.00', difference: '5349.50', status: 'differs' });
    expect(b.flags.find((f: { code: string }) => f.code === 'duplicate_entries').rows).toHaveLength(2);
  });

  test('a bad ledger figure is refused, not guessed', async () => {
    expect((await call(sF, 'GET', `/engagements/${eng}/bank-statements/${id}/analysis?ledger=abc`)).statusCode).toBe(422);
  });

  test('a confirmed statement can no longer be changed or removed', async () => {
    expect((await call(sF, 'DELETE', `/engagements/${eng}/bank-statements/${id}`)).statusCode).toBe(409);
    expect((await call(sF, 'POST', `/engagements/${eng}/bank-statements/${id}/confirm`, {})).statusCode).toBe(409);
    await expect(ownerQuery(h, T.id, 'update bank_statements set content_enc = $2 where id = $1', [id, 'v1.x.y.z'], F.id)).rejects.toThrow(/statement_confirmed/);
    await expect(ownerQuery(h, T.id, 'delete from bank_statements where id = $1', [id], F.id)).rejects.toThrow(/statement_confirmed/);
  });

  test('an unconfirmed statement read wrongly can be discarded, and that is logged', async () => {
    const bad = (await upload(sF, 'wrong-month.csv', csvBuf())).json().id;
    expect((await call(sF, 'DELETE', `/engagements/${eng}/bank-statements/${bad}`)).statusCode).toBe(204);
    expect((await call(sF, 'GET', `/engagements/${eng}/bank-statements/${bad}`)).statusCode).toBe(404);
    expect((await trail(sM)).map((e) => e.sentence).join('\n')).toMatch(/discarded the unconfirmed bank statement "wrong-month.csv" for Mwangaza Traders Ltd/);
  });
});

describe('who can see statements, and the trail of looking', () => {
  let id: string;
  beforeAll(async () => {
    id = (await upload(sF, 'visible.csv', csvBuf())).json().id;
  });

  test('the team reads entries a page at a time, and opening them is logged in plain English', async () => {
    const r = await call(sF, 'GET', `/engagements/${eng}/bank-statements/${id}?limit=3`);
    expect(r.statusCode).toBe(200);
    expect(r.json().transactions).toHaveLength(3);
    expect(r.json().transactions[0]).toMatchObject({ index: 0, date: '2026-03-02', amount: '-5000.00', balance: '95000.00' });
    const sentences = (await trail(sM)).map((e) => e.sentence).join('\n');
    expect(sentences).toMatch(/viewed the bank statement "visible.csv" for Mwangaza Traders Ltd/);
    expect(sentences).toMatch(/uploaded the bank statement "visible.csv" for Mwangaza Traders Ltd/);
  });

  test('a partner not on the team may read it, but not change it', async () => {
    expect((await call(sP2, 'GET', `/engagements/${eng}/bank-statements/${id}`)).statusCode).toBe(200);
    expect((await call(sP2, 'GET', `/engagements/${eng}/bank-statements`)).json().statements.length).toBeGreaterThan(0);
    expect((await call(sP2, 'POST', `/engagements/${eng}/bank-statements/${id}/confirm`, {})).statusCode).toBe(404);
    expect((await call(sP2, 'DELETE', `/engagements/${eng}/bank-statements/${id}`)).statusCode).toBe(404);
  });

  test('a manager or staff member not on the team sees nothing', async () => {
    for (const s of [sOS, sM2]) {
      expect((await call(s, 'GET', `/engagements/${eng}/bank-statements`)).statusCode).toBe(404);
      expect((await call(s, 'GET', `/engagements/${eng}/bank-statements/${id}`)).statusCode).toBe(404);
    }
  });

  test('a malformed id is a plain not found', async () => {
    expect((await call(sF, 'GET', `/engagements/${eng}/bank-statements/not-a-uuid`)).statusCode).toBe(404);
  });
});
