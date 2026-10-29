import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PoolClient } from 'pg';
import { withTenant } from '@auditos/db';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant, T2: TestTenant;
let A: TestUser, AP: TestUser, P: TestUser, M: TestUser, M2: TestUser, F: TestUser, B: TestUser;
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
const save = (u: TestUser, b: object = branding()) => asT(u, (tx) => tx.query('select branding_save($1::jsonb)', [JSON.stringify(b)]));
const auditCount = async () => Number((await ownerQuery(h, T.id, "select count(*) as n from audit_events where action = 'branding.updated' and tenant_id = $1", [T.id])).rows[0].n);
const lastAudit = async () => (await ownerQuery(h, T.id, "select * from audit_events where action = 'branding.updated' and tenant_id = $1 order by seq desc limit 1", [T.id])).rows[0];
const addLogo = (u: TestUser, type = 'image/png', bytes: Buffer = PNG, w = 100, hh = 50) =>
  asT(u, async (tx) => (await tx.query('select branding_add_logo($1, $2, $3, $4) as id', [type, bytes, w, hh])).rows[0].id as string);

const draftInvoice = async (): Promise<string> =>
  (await call(sP, 'POST', '/invoices', { clientId: client, taxMode: 'exclusive', taxIds: [], lines: [{ description: 'Audit fee', quantity: '1', unitPrice: '100000.00' }] })).json().id;
/** The API now writes the letterhead itself when it issues or sends. These tests are about the database functions on a document that has none yet, so the copy is removed again (as it would be on a document issued before letterheads existed). */
const blank = async (table: 'invoices' | 'quotes', id: string): Promise<void> => {
  const trigger = table === 'invoices' ? 'invoices_letterhead_guard' : 'quotes_letterhead_guard';
  const c = await h.owner.connect();
  try {
    await c.query('BEGIN');
    await c.query("select set_config('app.tenant_id', $1, true)", [T.id]);
    await c.query("select set_config('app.user_id', $1, true)", [P.id]);
    await c.query("select set_config('app.invoicing', 'on', true)");
    await c.query(`alter table ${table} disable trigger ${trigger}`);
    await c.query(`update ${table} set letterhead = null where id = $1`, [id]);
    await c.query(`alter table ${table} enable trigger ${trigger}`);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
};
const issueInv = async (id: string) => {
  const r = await call(sP, 'POST', `/invoices/${id}/issue`);
  if (r.statusCode === 200) await blank('invoices', id);
  return r;
};
const sendQuote = async (id: string) => {
  const r = await call(sM, 'POST', `/quotes/${id}/send`, {});
  if (r.statusCode === 200) await blank('quotes', id);
  return r;
};
const issued = async (): Promise<string> => {
  const id = await draftInvoice();
  expect((await issueInv(id)).statusCode).toBe(200);
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
  M2 = await makeUser(h, T.id, 'manager', 3);
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
    await save(AP, branding({ logoId: id, footerNote: '' }));
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
    await save(A);
    await addLogo(A);
    for (const u of [P, M, F]) {
      expect((await asT(u, (tx) => tx.query('select 1 from firm_branding'))).rowCount).toBe(1);
      expect((await asT(u, (tx) => tx.query('select 1 from firm_logos'))).rowCount).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('the audit entry of a save', () => {
  test('a real save writes exactly one entry, with the actor, the entity and what changed worked out by the database', async () => {
    await save(A, branding({ primaryColor: '#111111', secondaryColor: '#222222', phone: '+254 1' }));
    const n = await auditCount();
    await save(A, branding({ primaryColor: '#333333', secondaryColor: '#222222', phone: '+254 2' }));
    expect(await auditCount()).toBe(n + 1);
    const e = await lastAudit();
    expect(e.actor_user_id).toBe(A.id);
    expect(e.entity_type).toBe('branding');
    expect(e.entity_id).toBe(T.id);
    expect(e.detail).toEqual({ changed: ['primaryColor', 'phone'], primaryColor: { old: '#111111', new: '#333333' } });
  });
  test('a save that changes nothing writes no entry', async () => {
    await save(A, branding({ footerNote: 'same' }));
    const n = await auditCount();
    await save(A, branding({ footerNote: 'same' }));
    expect(await auditCount()).toBe(n);
  });
  test('a logo change names the logo without its bytes; colours show old and new', async () => {
    const logo = await addLogo(A);
    await save(A, branding({ logoId: null, secondaryColor: '#444444' }));
    await save(A, branding({ logoId: logo, secondaryColor: '#555555' }));
    expect((await lastAudit()).detail).toEqual({ changed: ['logo', 'secondaryColor'], secondaryColor: { old: '#444444', new: '#555555' } });
  });
  test('a key that is absent keeps the saved value; a present null or blank clears it', async () => {
    const logo = await addLogo(A);
    await save(A, branding({ logoId: logo, phone: '+254 9', footerNote: 'keep me' }));
    await save(A, { primaryColor: '#123456' });
    const row = async () => (await ownerQuery(h, T.id, 'select * from firm_branding where tenant_id = $1', [T.id])).rows[0];
    expect(await row()).toMatchObject({ primary_color: '#123456', logo_id: logo, phone: '+254 9', footer_note: 'keep me', secondary_color: '#e8c547' });
    expect((await lastAudit()).detail).toEqual({ changed: ['primaryColor'], primaryColor: { old: '#1f5f4a', new: '#123456' } });
    await save(A, { phone: '', logoId: null });
    expect(await row()).toMatchObject({ primary_color: '#123456', logo_id: null, phone: null, footer_note: 'keep me' });
  });
  test('the list the caller might want to send is not accepted, so it cannot be forged', async () => {
    expect(await code(asT(A, (tx) => tx.query('select branding_save($1::jsonb, $2::text[])', [JSON.stringify(branding()), ['bogus']])))).toBe('42883');
  });
  test('the audit trail shows the entry without failing', async () => {
    await save(A, branding({ footerNote: 'trail ' + Date.now() }));
    const res = await call(sP, 'GET', '/audit-trail');
    expect(res.statusCode).toBe(200);
    const ev = res.json().events.find((e: { action: string }) => e.action === 'branding.updated');
    expect(typeof ev.sentence).toBe('string');
  });
});

describe('one firm cannot see another', () => {
  test('firm B sees none of firm A branding or logos, and cannot use a logo of A', async () => {
    await save(A);
    const logoOfA = await addLogo(A);
    expect((await as(T2, B, (tx) => tx.query('select 1 from firm_branding'))).rowCount).toBe(0);
    expect((await as(T2, B, (tx) => tx.query('select 1 from firm_logos'))).rowCount).toBe(0);
    expect(await code(as(T2, B, (tx) => tx.query('select branding_save($1::jsonb)', [JSON.stringify(branding({ logoId: logoOfA }))])))).toBe('23503');
  });
});

describe('logos are insert-only', () => {
  test('the app role cannot update or delete a logo', async () => {
    const id = await addLogo(A);
    expect(await code(asT(A, (tx) => tx.query('update firm_logos set width = 5 where id = $1', [id])))).toBe('42501');
    expect(await code(asT(A, (tx) => tx.query('delete from firm_logos where id = $1', [id])))).toBe('42501');
  });
  test('not even the owner role can change a stored logo through row security', async () => {
    const id = await addLogo(A);
    expect((await ownerQuery(h, T.id, 'update firm_logos set width = 5 where id = $1', [id])).rowCount).toBe(0);
    expect((await ownerQuery(h, T.id, 'delete from firm_logos where id = $1', [id])).rowCount).toBe(0);
    expect((await ownerQuery(h, T.id, 'select width from firm_logos where id = $1', [id])).rows[0].width).toBe(100);
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
    expect((await sendQuote(id)).statusCode).toBe(200);
    expect(await code(setQuote(F, id)), 'staff cannot even see it').toBe('AO404');
    expect(await code(setQuote(M2, id)), 'another manager is not the creator').toBe('AO403');
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
    await sendQuote(id);
    await setQuote(P, id);
    expect(await quoteLetterhead(id)).toEqual(LH);
  });
  test('authorisation is checked before the shape of the letterhead', async () => {
    const id = await draftQuote();
    await sendQuote(id);
    expect(await code(setQuote(M2, id, [1] as unknown as object))).toBe('AO403');
    expect(await code(setQuote(M, id, [1] as unknown as object))).toBe('AO422');
  });
  test('an accepted quotation that never got one cannot get one later', async () => {
    const id = await draftQuote();
    await sendQuote(id);
    expect((await call(sM, 'POST', `/quotes/${id}/accept`, {})).statusCode).toBeLessThan(300);
    expect(await code(setQuote(M, id))).toBe('AO409');
    expect(await quoteLetterhead(id)).toBeNull();
  });
});

describe('the letterhead cannot be forced in a raw session', () => {
  // The two session flags are what the functions switch on; setting them by hand must not be enough.
  const raw = (u: TestUser, sql: string, params: unknown[]) =>
    asT(u, async (tx) => {
      await tx.query("select set_config('app.invoicing', 'on', true), set_config('app.letterhead', 'on', true)");
      return tx.query(sql, params);
    });
  test('a letterhead that is set cannot be rewritten or cleared', async () => {
    const id = await issued();
    await setInv(P, id);
    expect(await code(raw(P, "update invoices set letterhead = '{\"a\":1}'::jsonb where id = $1", [id]))).toBe('AO409');
    expect(await code(raw(P, 'update invoices set letterhead = null where id = $1', [id]))).toBe('AO409');
    const q = await draftQuote();
    await sendQuote(q);
    await setQuote(M, q);
    expect(await code(raw(M, "update quotes set letterhead = '{\"a\":1}'::jsonb where id = $1", [q]))).toBe('AO409');
    expect(await invLetterhead(id)).toEqual(LH);
    expect(await quoteLetterhead(q)).toEqual(LH);
  });
  test('a draft cannot get one', async () => {
    const id = await draftInvoice();
    expect(await code(raw(P, "update invoices set letterhead = '{\"a\":1}'::jsonb where id = $1", [id]))).toBe('AO409');
    const q = await draftQuote();
    expect(await code(raw(M, "update quotes set letterhead = '{\"a\":1}'::jsonb where id = $1", [q]))).toBe('AO409');
  });
  test('a paid or void invoice and an accepted quotation cannot get one', async () => {
    const inv = await issued();
    await call(sP, 'POST', `/invoices/${inv}/void`, { reason: 'Issued in error' });
    expect(await code(setInv(P, inv))).toBe('AO409');
    expect(await code(raw(P, "update invoices set letterhead = '{\"a\":1}'::jsonb where id = $1", [inv]))).toBe('AO409');
    expect(await invLetterhead(inv)).toBeNull();
  });
  test('someone without billing rights cannot set a first one, on an invoice or a quotation', async () => {
    // a manager who created an invoice sees it but may not issue it
    const inv = (await call(sM, 'POST', '/invoices', { clientId: client, taxMode: 'exclusive', taxIds: [], lines: [{ description: 'Fee', quantity: '1', unitPrice: '5000.00' }] })).json().id as string;
    expect((await issueInv(inv)).statusCode).toBe(200);
    expect(await code(raw(M, "update invoices set letterhead = '{\"a\":1}'::jsonb where id = $1", [inv]))).toBe('AO403');
    const q = await draftQuote();
    await sendQuote(q);
    expect(await code(raw(M2, "update quotes set letterhead = '{\"a\":1}'::jsonb where id = $1", [q]))).toBe('AO403');
    expect(await invLetterhead(inv)).toBeNull();
    expect(await quoteLetterhead(q)).toBeNull();
  });
  test('authorisation is checked before the shape of the letterhead for invoices', async () => {
    const id = await issued();
    expect(await code(setInv(M, id, [1] as unknown as object))).toBe('AO403');
  });
});

describe('firm_letterhead_identity', () => {
  test('gives any member the legal name, address and KRA PIN of their own firm only, never bank details', async () => {
    await ownerQuery(h, T.id, 'update billing_settings set address = $1, bank_details = $2', ['Old Street 1, Nairobi', 'Secret Bank, account 111'], P.id);
    const p2 = await makeUser(h, T2.id, 'partner', 4);
    const f2 = await makeUser(h, T2.id, 'staff', 1);
    await ownerQuery(h, T2.id, "insert into billing_settings (tenant_id, legal_name, kra_pin, bank_details) values ($1, 'Other Firm LLP', 'A000000001Z', 'Other Bank')", [T2.id], p2.id);
    // The staff member cannot read the table itself...
    expect((await asT(F, (tx) => tx.query('select * from billing_settings'))).rows).toEqual([]);
    // ...but can read the three identity fields through the function.
    const mine = (await asT(F, (tx) => tx.query('select * from firm_letterhead_identity()'))).rows;
    expect(mine).toEqual([{ legal_name: 'Kangethe & Associates', address: 'Old Street 1, Nairobi', kra_pin: 'P051234567Q' }]);
    expect(JSON.stringify(mine)).not.toMatch(/Bank|account 111/);
    const theirs = (await as(T2, f2, (tx) => tx.query('select * from firm_letterhead_identity()'))).rows;
    expect(theirs).toEqual([{ legal_name: 'Other Firm LLP', address: null, kra_pin: 'A000000001Z' }]);
  });

  test('the table stays closed: raising the flag from a raw session reveals nothing', async () => {
    const rows = (await asT(F, async (tx) => {
      await tx.query("select set_config('app.letterhead_identity', 'on', true)");
      return tx.query('select * from billing_settings');
    })).rows;
    expect(rows).toEqual([]);
  });
});
