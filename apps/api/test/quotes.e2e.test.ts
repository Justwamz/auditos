import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, A: TestUser, M: TestUser, M2: TestUser, F: TestUser;
let sP: Session, sA: Session, sM: Session, sM2: Session, sF: Session;
let client: string;
let otherClient: string;
let prospect: string;
let eng: string;
let vat: string;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const quote = (over: object = {}) => ({ clientId: client, title: 'Audit of FY2026', validUntil: '2027-01-31', taxMode: 'exclusive', taxIds: [], lines: [{ description: 'Statutory audit', quantity: '1', unitPrice: '400000.00' }], ...over });
const make = async (s: Session, over: object = {}) => (await call(s, 'POST', '/quotes', quote(over))).json().id as string;
const get = async (s: Session, id: string) => (await call(s, 'GET', `/quotes/${id}`)).json();

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'quotes');
  P = await makeUser(h, T.id, 'partner', 4);
  A = await makeUser(h, T.id, 'firm_admin', 0);
  M = await makeUser(h, T.id, 'manager', 3);
  M2 = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sA = await login(h, A);
  sM = await login(h, M);
  sM2 = await login(h, M2);
  sF = await login(h, F);
  for (const s of [sP, sM]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  await call(sP, 'PUT', '/billing/settings', { legalName: 'Kangethe & Associates', quotePrefix: 'KQ' });
  vat = (await call(sP, 'POST', '/billing/taxes', { name: 'VAT', rate: '16' })).json().id;
  client = (await call(sM, 'POST', '/clients', { name: 'Quoted Traders Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  otherClient = (await call(sM2, 'POST', '/clients', { name: 'Other Quoted Ltd', sector: 'rental', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  eng = (await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  prospect = (await call(sF, 'POST', '/prospects', { name: 'Future Clinic Ltd', sector: 'consultancy' })).json().id;
});
afterAll(async () => h.close());

describe('drafting a quotation', () => {
  test('for a client, with the taxes chosen on it; totals to the cent', async () => {
    const q = await get(sM, await make(sM, { taxIds: [vat], lines: [{ description: 'Audit', quantity: '1', unitPrice: '400000.00' }, { description: 'Tax computation', quantity: '2', unitPrice: '12345.67' }] }));
    expect(q).toMatchObject({ status: 'draft', number: null, subtotal: '424691.34', taxTotal: '67950.61', total: '492641.95', subjectName: 'Quoted Traders Ltd' });
  });

  test('for a prospect as well, with the tax already included in the price', async () => {
    const q = await get(sM, await make(sM, { clientId: undefined, prospectId: prospect, taxMode: 'inclusive', taxIds: [vat], lines: [{ description: 'Audit', quantity: '1', unitPrice: '116000.00' }] }));
    expect(q).toMatchObject({ subtotal: '100000.00', taxTotal: '16000.00', total: '116000.00', subjectName: 'Future Clinic Ltd' });
  });

  test('exactly one of client or prospect; no empty or invalid quotations', async () => {
    expect((await call(sM, 'POST', '/quotes', quote({ prospectId: prospect }))).statusCode).toBe(400);
    expect((await call(sM, 'POST', '/quotes', quote({ clientId: undefined }))).statusCode).toBe(400);
    expect((await call(sM, 'POST', '/quotes', quote({ lines: [] }))).statusCode).toBe(400);
    expect((await call(sM, 'POST', '/quotes', quote({ title: '' }))).statusCode).toBe(400);
    expect((await call(sM, 'POST', '/quotes', quote({ validUntil: 'soon' }))).statusCode).toBe(400);
    expect((await call(sM, 'POST', '/quotes', quote({ taxIds: ['00000000-0000-4000-8000-000000000000'] }))).statusCode).toBe(400);
  });

  test('only for a client or prospect you can see; staff cannot quote', async () => {
    expect((await call(sM, 'POST', '/quotes', quote({ clientId: otherClient }))).statusCode).toBe(404);
    expect((await call(sF, 'POST', '/quotes', quote())).statusCode).toBe(403);
  });

  test('a draft can be revised', async () => {
    const id = await make(sM);
    expect((await call(sM, 'PUT', `/quotes/${id}`, quote({ title: 'Revised title', lines: [{ description: 'Audit', quantity: '1', unitPrice: '500000.00' }] }))).statusCode).toBe(200);
    expect(await get(sM, id)).toMatchObject({ title: 'Revised title', total: '500000.00' });
  });
});

describe('sending, deciding and applying the fee', () => {
  let id: string;
  beforeAll(async () => {
    id = await make(sM);
  });

  test('sending numbers it and freezes it; quote numbers have their own sequence', async () => {
    const r = await call(sM, 'POST', `/quotes/${id}/send`, { to: 'director@quoted.example.test', message: 'Our quotation is attached.' });
    expect(r.statusCode).toBe(200);
    expect(r.json().number).toMatch(/^KQ-\d{4}-0001$/);
    expect(await get(sM, id)).toMatchObject({ status: 'sent' });
    expect((await call(sM, 'PUT', `/quotes/${id}`, quote({ title: 'Too late' }))).statusCode).toBe(409);
    expect((await call(sM, 'POST', `/quotes/${id}/send`, {})).statusCode).toBe(409);
    const second = await make(sM);
    expect(((await call(sM, 'POST', `/quotes/${second}/send`, {})).json().number as string)).toMatch(/^KQ-\d{4}-0002$/);
  });

  test('sending to an address leaves a message in the simulated outbox', async () => {
    const box = (await call(sM, 'GET', '/outbox')).json().messages as { kind: string; to: string; subject: string; delivered: boolean }[];
    expect(box.find((m) => m.kind === 'quote')).toMatchObject({ to: 'director@quoted.example.test', delivered: false });
    expect(box.find((m) => m.kind === 'quote')!.subject).toMatch(/Quotation KQ-\d{4}-0001/);
  });

  test('the fee cannot be applied before the quotation is accepted', async () => {
    expect((await call(sM, 'POST', `/quotes/${id}/apply-fee`, { engagementId: eng })).statusCode).toBe(409);
  });

  test('accepted once; then no more decisions', async () => {
    expect((await call(sF, 'POST', `/quotes/${id}/accept`)).statusCode).toBe(403);
    expect((await call(sM, 'POST', `/quotes/${id}/accept`)).statusCode).toBe(200);
    expect(await get(sM, id)).toMatchObject({ status: 'accepted' });
    expect((await call(sM, 'POST', `/quotes/${id}/decline`)).statusCode).toBe(409);
    expect((await call(sM, 'POST', `/quotes/${id}/accept`)).statusCode).toBe(409);
  });

  test('applying the accepted fee sets a flat fee on an engagement of the same client', async () => {
    expect((await call(sM, 'POST', `/quotes/${id}/apply-fee`, { engagementId: eng })).statusCode).toBe(200);
    expect((await call(sM, 'GET', `/engagements/${eng}/fee`)).json().fee).toMatchObject({ basis: 'flat', flatFee: '400000.00' });
  });

  test('not for another client\'s engagement, nor one the manager is not on', async () => {
    const otherEng = (await call(sM2, 'POST', '/engagements', { clientId: otherClient, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
    expect([400, 404]).toContain((await call(sM, 'POST', `/quotes/${id}/apply-fee`, { engagementId: otherEng })).statusCode);
    expect((await call(sM2, 'POST', `/quotes/${id}/apply-fee`, { engagementId: eng })).statusCode).toBe(404);
  });

  test('a quotation can be declined instead', async () => {
    const q = await make(sM);
    await call(sM, 'POST', `/quotes/${q}/send`, {});
    expect((await call(sM, 'POST', `/quotes/${q}/decline`)).statusCode).toBe(200);
    expect(await get(sM, q)).toMatchObject({ status: 'declined' });
    expect((await call(sM, 'POST', `/quotes/${q}/apply-fee`, { engagementId: eng })).statusCode).toBe(409);
  });
});

describe('who sees quotations', () => {
  test('managers, partners and the administrator see them; staff do not', async () => {
    const id = await make(sM);
    for (const s of [sM, sM2, sP, sA]) expect((await call(s, 'GET', `/quotes/${id}`)).statusCode).toBe(200);
    expect((await call(sF, 'GET', `/quotes/${id}`)).statusCode).toBe(403);
    expect((await call(sF, 'GET', '/quotes')).statusCode).toBe(403);
    expect(((await call(sM2, 'GET', '/quotes')).json().quotes as unknown[]).length).toBeGreaterThan(0);
  });

  test('the PDF is a PDF', async () => {
    const id = await make(sM);
    const r = await call(sM, 'GET', `/quotes/${id}/pdf`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('the audit trail', () => {
  test('sending and deciding read as sentences', async () => {
    const t = (await call(sP, 'GET', '/audit-trail?kind=changes&limit=200')).json().events as { sentence: string }[];
    const text = t.map((e) => e.sentence).join('\n');
    expect(text).toMatch(/sent quotation KQ-\d{4}-0001 to Quoted Traders Ltd for KES 400,000\.00/);
    expect(text).toMatch(/recorded that quotation KQ-\d{4}-0001 was accepted by Quoted Traders Ltd/);
    expect(text).toMatch(/was declined by Quoted Traders Ltd/);
  });
});
