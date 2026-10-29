import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PoolClient } from 'pg';
import { withTenant } from '@auditos/db';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant, T2: TestTenant;
let A: TestUser, AP: TestUser, P: TestUser, M: TestUser, F: TestUser, B: TestUser;
let sP: Session, sM: Session;
let client: string;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const as = <R>(tenant: TestTenant, u: TestUser, fn: (tx: PoolClient) => Promise<R>) =>
  withTenant(h.app.pools.app, { tenantId: tenant.id, userId: u.id }, fn);
const asT = <R>(u: TestUser, fn: (tx: PoolClient) => Promise<R>) => as(T, u, fn);

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40, 1)]);
const JPG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(40, 2)]);
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
  return 'none';
};
const branding = (over: object = {}) => ({ primaryColor: '#1f5f4a', secondaryColor: '#e8c547', phone: '+254 700 000 000', email: 'info@firm.example.test', website: 'https://firm.example.test', footerNote: 'Thank you', ...over });
const save = (u: TestUser, b: object = branding(), changed: string[] = ['primaryColor']) =>
  asT(u, (tx) => tx.query('select branding_save($1::jsonb, $2::text[])', [JSON.stringify(b), changed]));
const addLogo = (u: TestUser, type = 'image/png', bytes: Buffer = PNG, w = 100, hh = 50) =>
  asT(u, async (tx) => (await tx.query('select branding_add_logo($1, $2, $3, $4) as id', [type, bytes, w, hh])).rows[0].id as string);

const draftInvoice = async (): Promise<string> =>
  (await call(sP, 'POST', '/invoices', { clientId: client, taxMode: 'exclusive', taxIds: [], lines: [{ description: 'Audit fee', quantity: '1', unitPrice: '100000.00' }] })).json().id;
const issued = async (): Promise<string> => {
  const id = await draftInvoice();
  expect((await call(sP, 'POST', `/invoices/${id}/issue`)).statusCode).toBe(200);
  return id;
};
const draftQuote = async (s: Session = sM): Promise<string> =>
  (await call(s, 'POST', '/quotes', { clientId: client, title: 'Audit', validUntil: '2027-01-31', taxMode: 'exclusive', taxIds: [], lines: [{ description: 'Audit', quantity: '1', unitPrice: '400000.00' }] })).json().id;
const LH = { name: 'Kangethe & Associates', primaryColor: '#1f5f4a', logoId: null };
const setInv = (u: TestUser, id: string, lh: object = LH) => asT(u, (tx) => tx.query('select invoice_set_letterhead($1, $2::jsonb)', [id, JSON.stringify(lh)]));
const setQuote = (u: TestUser, id: string, lh: object = LH) => asT(u, (tx) => tx.query('select quote_set_letterhead($1, $2::jsonb)', [id, JSON.stringify(lh)]));
const invLetterhead = async (id: string) => (await ownerQuery(h, T.id, 'select letterhead from invoices where id = $1', [id], P.id)).rows[0].letterhead;
const quoteLetterhead = async (id: string) => (await ownerQuery(h, T.id, 'select letterhead from quotes where id = $1', [id], P.id)).rows[0].letterhead;

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'branding');
  T2 = await makeTenant(h, 'branding-b');
  A = { id: T.adminId, email: '', secret: '' };
  AP = await makeUser(h, T.id, 'staff', 1); // a staff member who holds the administrator permission
  await ownerQuery(h, T.id, 'update memberships set is_admin = true where user_id = $1', [AP.id]);
  P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  B = { id: T2.adminId, email: '', secret: '' };
  sP = await login(h, P);
  sM = await login(h, M);
  await call(sP, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  await call(sM, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  await call(sP, 'PUT', '/billing/settings', { legalName: 'Kangethe & Associates', kraPin: 'P051234567Q', invoicePrefix: 'KA', quotePrefix: 'KQ' });
  client = (await call(sM, 'POST', '/clients', { name: 'Branded Traders Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
});
afterAll(async () => h.close());

describe('who may change branding', () => {
  test('the firm administrator saves branding and adds a logo; so does a holder of the administrator permission', async () => {
    await save(A);
    const id = await addLogo(A);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await save(AP, branding({ logoId: id, footerNote: '' }), ['logo', 'footerNote']);
    const row = (await asT(A, (tx) => tx.query('select * from firm_branding'))).rows[0];
    expect(row).toMatchObject({ primary_color: '#1f5f4a', logo_id: id, footer_note: null, phone: '+254 700 000 000' });
    await addLogo(AP, 'image/jpeg', JPG);
  });

  test('a partner, manager and staff member are each refused by both functions', async () => {
    for (const u of [P, M, F]) {
      expect(await code(save(u)), 'branding_save').toBe('AO403');
      expect(await code(addLogo(u)), 'branding_add_logo').toBe('AO403');
    }
  });

  test('the app role cannot write the tables directly, even as the administrator', async () => {
    expect(await code(asT(A, (tx) => tx.query("insert into firm_branding (tenant_id, primary_color) values ($1, '#000000')", [T.id])))).toBe('42501');
    expect(await code(asT(A, (tx) => tx.query('update firm_branding set phone = null')))).toBe('42501');
    expect(await code(asT(A, (tx) => tx.query('insert into firm_logos (tenant_id, content_type, bytes, width, height) values ($1, $2, $3, 1, 1)', [T.id, 'image/png', PNG])))).toBe('42501');
  });

  test('every member of the firm reads branding and logos', async () => {
    for (const u of [P, M, F]) {
      expect((await asT(u, (tx) => tx.query('select 1 from firm_branding'))).rowCount).toBe(1);
      expect((await asT(u, (tx) => tx.query('select 1 from firm_logos'))).rowCount).toBe(2);
    }
  });

  test('saving records one audit entry with the list of what changed', async () => {
    await save(A, branding(), ['phone', 'website']);
    const r = await ownerQuery(h, T.id, "select detail, action from audit_events where action = 'branding.updated' order by seq desc limit 1");
    expect(r.rows[0].detail).toEqual({ changed: ['phone', 'website'] });
  });

  test('the audit trail shows the entry without failing', async () => {
    const res = await call(sP, 'GET', '/audit-trail');
    expect(res.statusCode).toBe(200);
    const ev = res.json().events.find((e: { action: string }) => e.action === 'branding.updated');
    expect(typeof ev.sentence).toBe('string');
  });
});

describe('one firm cannot see another', () => {
  test('firm B sees none of firm A branding or logos, and cannot use a logo of A', async () => {
    expect((await as(T2, B, (tx) => tx.query('select 1 from firm_branding'))).rowCount).toBe(0);
    expect((await as(T2, B, (tx) => tx.query('select 1 from firm_logos'))).rowCount).toBe(0);
    const logoOfA = (await ownerQuery(h, T.id, 'select id from firm_logos limit 1')).rows[0].id as string;
    expect(await code(as(T2, B, (tx) => tx.query('select branding_save($1::jsonb, $2::text[])', [JSON.stringify(branding({ logoId: logoOfA })), ['logo']])))).toBe('23503');
  });
});

describe('logos are insert-only', () => {
  test('the app role cannot update or delete a logo', async () => {
    expect(await code(asT(A, (tx) => tx.query('update firm_logos set width = 5')))).toBe('42501');
    expect(await code(asT(A, (tx) => tx.query('delete from firm_logos')))).toBe('42501');
  });
  test('not even the owner role can change a stored logo through row security', async () => {
    const r = await ownerQuery(h, T.id, 'update firm_logos set width = 5');
    expect(r.rowCount).toBe(0);
    const d = await ownerQuery(h, T.id, 'delete from firm_logos');
    expect(d.rowCount).toBe(0);
  });
});

describe('values the database refuses', () => {
  test('a bad email, a website that is not http(s), a bad phone, a bad colour and a long note', async () => {
    for (const bad of [{ email: 'not-an-email' }, { website: 'ftp://firm.example.test' }, { website: 'firm.example.test' }, { phone: 'call me' }, { primaryColor: 'green' }, { secondaryColor: '#12345' }, { footerNote: 'x'.repeat(301) }]) {
      expect(await code(save(A, branding(bad))), JSON.stringify(bad)).toBe('23514');
    }
  });
  test('an oversize logo, an SVG, a wrong declared type, a disguised file and absurd dimensions', async () => {
    expect(await code(addLogo(A, 'image/png', Buffer.concat([PNG, Buffer.alloc(1048576)])))).toBe('23514');
    expect(await code(addLogo(A, 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBe('23514');
    expect(await code(addLogo(A, 'image/png', JPG))).toBe('23514');
    expect(await code(addLogo(A, 'image/png', Buffer.from('<script>alert(1)</script>')))).toBe('23514');
    expect(await code(addLogo(A, 'image/png', PNG, 2001, 10))).toBe('23514');
  });
  test('a logo of exactly 1 MB is accepted', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(1048576 - PNG.length)]);
    expect(await code(addLogo(A, 'image/png', big))).toBe('none');
  });
});

describe('the letterhead of an issued invoice is written once', () => {
  test('a draft cannot get one, neither by the function nor by a direct update', async () => {
    const id = await draftInvoice();
    expect(await code(setInv(P, id))).toBe('AO409');
    expect(await code(asT(P, (tx) => tx.query("update invoices set letterhead = '{}'::jsonb where id = $1", [id])))).toBe('AO409');
    expect(await invLetterhead(id)).toBeNull();
  });
  test('an issued invoice gets it once and a second write fails; its other functions still work', async () => {
    const id = await issued();
    expect(await invLetterhead(id)).toBeNull();
    await setInv(P, id);
    expect(await invLetterhead(id)).toEqual(LH);
    expect(await code(setInv(P, id, { name: 'Changed' }))).toBe('AO409');
    expect(await code(asT(P, (tx) => tx.query("update invoices set letterhead = null where id = $1", [id])))).toBe('AO409');
    expect(await code(asT(P, (tx) => tx.query("update invoices set notes = 'x' where id = $1", [id])))).toBe('AO409'); // frozen as before
    expect((await call(sP, 'POST', `/invoices/${id}/payments`, { amount: '1000.00', paidOn: '2026-10-01', method: 'cash' })).statusCode).toBeLessThan(300);
    expect(await invLetterhead(id)).toEqual(LH);
  });
  test('the owner cannot rewrite it through the guard either, and voiding keeps it', async () => {
    const id = await issued();
    await setInv(P, id);
    await expect(ownerQuery(h, T.id, "update invoices set letterhead = '{\"a\":1}'::jsonb where id = $1", [id], P.id)).rejects.toMatchObject({ code: 'AO409' });
    expect((await call(sP, 'POST', `/invoices/${id}/void`, { reason: 'Issued in error' })).statusCode).toBe(200);
    expect(await invLetterhead(id)).toEqual(LH);
  });
  test('a manager or staff member cannot set it; an administrator can; it must be an object', async () => {
    const id = await issued();
    expect(await code(setInv(M, id))).toBe('AO403');
    expect(await code(setInv(F, id))).toBe('AO403');
    expect(await code(setInv(P, id, [1] as unknown as object))).toBe('AO422');
    await setInv(AP, id);
    expect(await invLetterhead(id)).toEqual(LH);
  });
  test('an unknown invoice is not found', async () => {
    expect(await code(setInv(P, '00000000-0000-4000-8000-000000000000'))).toBe('AO404');
  });
  test('a new invoice never starts with one', async () => {
    const id = await draftInvoice();
    expect(await invLetterhead(id)).toBeNull();
  });
});

describe('the letterhead of a sent quotation is written once', () => {
  test('a draft cannot get one', async () => {
    const id = await draftQuote();
    expect(await code(setQuote(M, id))).toBe('AO409');
  });
  test('the creator sets it once after sending; a second write fails', async () => {
    const id = await draftQuote();
    expect((await call(sM, 'POST', `/quotes/${id}/send`, {})).statusCode).toBe(200);
    expect(['AO403', 'AO404']).toContain(await code(setQuote(F, id)));
    await setQuote(M, id);
    expect(await quoteLetterhead(id)).toEqual(LH);
    expect(await code(setQuote(M, id, { name: 'Changed' }))).toBe('AO409');
    expect(await code(setQuote(P, id, { name: 'Changed' }))).toBe('AO409');
    expect(await code(asT(M, (tx) => tx.query("update quotes set letterhead = null where id = $1", [id])))).toBe('AO409');
    expect((await call(sM, 'POST', `/quotes/${id}/accept`, {})).statusCode).toBeLessThan(300);
    expect(await quoteLetterhead(id)).toEqual(LH);
  });
  test('a partner can set it for a manager quotation', async () => {
    const id = await draftQuote();
    await call(sM, 'POST', `/quotes/${id}/send`, {});
    await setQuote(P, id);
    expect(await quoteLetterhead(id)).toEqual(LH);
  });
});
