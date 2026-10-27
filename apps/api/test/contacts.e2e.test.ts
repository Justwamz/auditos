import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, A: TestUser, M: TestUser, F: TestUser, OUT: TestUser;
let sP: Session, sA: Session, sM: Session, sF: Session, sOut: Session;
let client: string;
let contact: string;

const call = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const reveals = async () => (await ownerQuery(h, T.id, "select detail, actor_user_id from audit_events where tenant_id = $1 and action = 'pii.revealed' order by seq", [T.id])).rows;

const PHONE = '+254 712 345 678';
const EMAIL = 'jane.wambui@mwangaza.co.ke';
const IDNO = '27654321';
const PIN = 'A012345678B';

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'contacts');
  P = await makeUser(h, T.id, 'partner', 4);
  A = await makeUser(h, T.id, 'firm_admin', 0);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  OUT = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sA = await login(h, A);
  sM = await login(h, M);
  sF = await login(h, F);
  sOut = await login(h, OUT);
  for (const s of [sP, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  client = (await call(sM, 'POST', '/clients', { name: 'Mwangaza Traders Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  const eng = (await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${eng}/members`, { userId: F.id });
  const r = await call(sM, 'POST', `/clients/${client}/contacts`, { name: 'Jane Wambui', position: 'Finance manager', phone: PHONE, email: EMAIL, idNumber: IDNO, kraPin: PIN });
  contact = r.json().id;
});
afterAll(async () => h.close());

describe('personal data is masked everywhere it is listed', () => {
  test('the list returns masks, never the real values', async () => {
    const r = await call(sF, 'GET', `/clients/${client}/contacts`);
    expect(r.statusCode).toBe(200);
    const c = r.json().contacts[0];
    expect(c).toMatchObject({ name: 'Jane Wambui', position: 'Finance manager', phone: '+••• ••• ••• 678', email: 'j•••@mwangaza.co.ke', idNumber: '•••••321', kraPin: '••••••••78B' });
    const body = r.body;
    for (const secret of [PHONE, '0712', IDNO, PIN, 'jane.wambui']) expect(body).not.toContain(secret);
  });

  test('nothing readable is stored in the database', async () => {
    const row = (await ownerQuery(h, T.id, 'select * from client_contacts where id = $1', [contact], P.id)).rows[0];
    const stored = JSON.stringify(row);
    for (const secret of [PHONE, '712345678', IDNO, PIN, 'jane.wambui']) expect(stored).not.toContain(secret);
    expect(row.phone_enc).toMatch(/^v1\./);
  });

  test('a malformed KRA PIN or email is rejected', async () => {
    expect((await call(sM, 'POST', `/clients/${client}/contacts`, { name: 'Peter Njoroge', kraPin: '123' })).statusCode).toBe(400);
    expect((await call(sM, 'POST', `/clients/${client}/contacts`, { name: 'Peter Njoroge', email: 'nope' })).statusCode).toBe(400);
  });

  test('editing a field keeps it masked in the response', async () => {
    const r = await call(sM, 'PATCH', `/clients/${client}/contacts/${contact}`, { phone: '0722111222' });
    expect(r.statusCode).toBe(200);
    expect(r.json().phone).toBe('••••••• 222'.replace(' ', ''));
  });
});

describe('revealing needs a reason and is always logged', () => {
  test('without a reason, or with a short one, nothing is returned and nothing is logged', async () => {
    const before = (await reveals()).length;
    expect((await call(sF, 'POST', `/clients/${client}/contacts/${contact}/reveal`, { field: 'phone' })).statusCode).toBe(400);
    expect((await call(sF, 'POST', `/clients/${client}/contacts/${contact}/reveal`, { field: 'phone', reason: 'x' })).statusCode).toBe(400);
    expect((await reveals()).length).toBe(before);
  });

  test('a team member who gives a reason gets the value, and the log records who, what and why', async () => {
    const r = await call(sF, 'POST', `/clients/${client}/contacts/${contact}/reveal`, { field: 'email', reason: 'Sending the engagement letter' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ field: 'email', value: EMAIL });
    const last = (await reveals()).at(-1)!;
    expect(last.actor_user_id).toBe(F.id);
    expect(last.detail).toMatchObject({ field: 'email', reason: 'Sending the engagement letter', contactName: 'Jane Wambui', clientName: 'Mwangaza Traders Ltd' });
    expect(JSON.stringify(last.detail)).not.toContain(EMAIL);
  });

  test('the reveal shows in the audit trail as a sentence with the reason', async () => {
    const t = (await call(sP, 'GET', '/audit-trail?kind=reveals')).json().events as { sentence: string }[];
    expect(t[0]!.sentence).toMatch(/revealed the email address of Jane Wambui at Mwangaza Traders Ltd\. Reason given: "Sending the engagement letter"$/);
  });

  test('a person who cannot see the client gets 404, and no event is written', async () => {
    const before = (await reveals()).length;
    expect((await call(sOut, 'POST', `/clients/${client}/contacts/${contact}/reveal`, { field: 'phone', reason: 'Just curious' })).statusCode).toBe(404);
    expect((await call(sOut, 'GET', `/clients/${client}/contacts`)).statusCode).toBe(404);
    expect((await reveals()).length).toBe(before);
  });

  test('a firm admin with no work role cannot read contacts or reveal', async () => {
    expect((await call(sA, 'GET', `/clients/${client}/contacts`)).statusCode).toBe(403);
    expect((await call(sA, 'POST', `/clients/${client}/contacts/${contact}/reveal`, { field: 'phone', reason: 'Checking records' })).statusCode).toBe(403);
  });

  test('a partner, who sees all clients, may reveal with a reason', async () => {
    const r = await call(sP, 'POST', `/clients/${client}/contacts/${contact}/reveal`, { field: 'kraPin', reason: 'Tax compliance check' });
    expect(r.json().value).toBe(PIN);
  });

  test('a detail that was never captured cannot be revealed', async () => {
    const other = (await call(sM, 'POST', `/clients/${client}/contacts`, { name: 'Peter Njoroge', phone: '0700000000' })).json().id;
    const before = (await reveals()).length;
    expect((await call(sM, 'POST', `/clients/${client}/contacts/${other}/reveal`, { field: 'email', reason: 'Need to email him' })).statusCode).toBe(404);
    expect((await reveals()).length).toBe(before);
  });
});
