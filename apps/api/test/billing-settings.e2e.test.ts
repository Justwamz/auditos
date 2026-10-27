import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, A: TestUser, M: TestUser, M2: TestUser, F: TestUser;
let sP: Session, sA: Session, sM: Session, sM2: Session, sF: Session;
let eng: string;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'billing');
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
  for (const s of [sP, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  const client = (await call(sM, 'POST', '/clients', { name: 'Billable Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  eng = (await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${eng}/members`, { userId: F.id });
});
afterAll(async () => h.close());

describe('who may read billing settings, rates and taxes', () => {
  test('partners, managers and the administrator read them; staff do not', async () => {
    for (const s of [sP, sM, sA]) expect((await call(s, 'GET', '/billing/settings')).statusCode).toBe(200);
    expect((await call(sF, 'GET', '/billing/settings')).statusCode).toBe(403);
  });
  test('a new firm starts with sensible defaults and no rates or taxes', async () => {
    const r = (await call(sP, 'GET', '/billing/settings')).json();
    expect(r.settings).toMatchObject({ invoicePrefix: 'INV', quotePrefix: 'QUO', paymentTermsDays: 30 });
    expect(r.rates).toEqual([]);
    expect(r.taxes).toEqual([]);
  });
});

describe('settings', () => {
  test('a partner sets the invoice details; a manager cannot', async () => {
    const body = { legalName: 'Kangethe & Associates', address: 'Nairobi', kraPin: 'P051234567Q', bankDetails: 'Bank X, account 123', invoicePrefix: 'KA', quotePrefix: 'KQ', paymentTermsDays: 14 };
    expect((await call(sM, 'PUT', '/billing/settings', body)).statusCode).toBe(403);
    expect((await call(sP, 'PUT', '/billing/settings', body)).statusCode).toBe(200);
    expect((await call(sM, 'GET', '/billing/settings')).json().settings).toMatchObject({ legalName: 'Kangethe & Associates', invoicePrefix: 'KA', paymentTermsDays: 14, kraPin: 'P051234567Q' });
  });
  test('bad values are refused', async () => {
    for (const bad of [{ kraPin: '123' }, { invoicePrefix: 'a' }, { invoicePrefix: 'TOOLONGPREFIX' }, { paymentTermsDays: -1 }, { paymentTermsDays: 400 }]) {
      expect((await call(sP, 'PUT', '/billing/settings', bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe('hourly rates', () => {
  test('partner or administrator sets them, as KES amounts per role; managers can read but not change', async () => {
    expect((await call(sM, 'PUT', '/billing/rates', { rates: { staff: '1500.00' } })).statusCode).toBe(403);
    expect((await call(sP, 'PUT', '/billing/rates', { rates: { staff: '1500.00', senior: '2500', manager: '4000.50', partner: '8000' } })).statusCode).toBe(200);
    const rates = (await call(sM, 'GET', '/billing/settings')).json().rates as { role: string; rate: string }[];
    expect(Object.fromEntries(rates.map((r) => [r.role, r.rate]))).toEqual({ staff: '1500.00', senior: '2500.00', manager: '4000.50', partner: '8000.00' });
    expect((await call(sA, 'PUT', '/billing/rates', { rates: { staff: '1600.00' } })).statusCode).toBe(200);
  });
  test('bad rates are refused', async () => {
    for (const bad of [{ staff: '-5' }, { staff: 'lots' }, { firm_admin: '100' }, { nobody: '100' }]) {
      expect((await call(sP, 'PUT', '/billing/rates', { rates: bad })).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe('the tax catalogue', () => {
  let vat: string;
  test('a partner adds taxes; rates are percentages with at most two decimals; nothing is preselected', async () => {
    expect((await call(sM, 'POST', '/billing/taxes', { name: 'VAT', rate: '16' })).statusCode).toBe(403);
    const r = await call(sP, 'POST', '/billing/taxes', { name: 'VAT', rate: '16' });
    expect(r.statusCode).toBe(201);
    vat = r.json().id;
    expect((await call(sP, 'POST', '/billing/taxes', { name: 'Excise duty', rate: '10' })).statusCode).toBe(201);
    expect((await call(sP, 'POST', '/billing/taxes', { name: 'VAT on excise', rate: '16', onPrevious: true })).statusCode).toBe(201);
    const taxes = (await call(sM, 'GET', '/billing/settings')).json().taxes as { name: string; rate: string; onPrevious: boolean; active: boolean }[];
    expect(taxes.map((t) => t.name).sort()).toEqual(['Excise duty', 'VAT', 'VAT on excise']);
    expect(taxes.find((t) => t.name === 'VAT')).toMatchObject({ rate: '16.00', onPrevious: false, active: true });
    expect(taxes.find((t) => t.name === 'VAT on excise')).toMatchObject({ onPrevious: true });
  });
  test('bad or duplicate taxes are refused', async () => {
    for (const bad of [{ name: 'X', rate: '101' }, { name: 'X', rate: '-1' }, { name: 'X', rate: '1.234' }, { name: 'X', rate: 'abc' }, { name: '', rate: '5' }]) {
      expect((await call(sP, 'POST', '/billing/taxes', bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await call(sP, 'POST', '/billing/taxes', { name: 'VAT', rate: '16' })).statusCode).toBe(409);
  });
  test('a tax can be renamed, changed or switched off (it is never deleted)', async () => {
    expect((await call(sP, 'PATCH', `/billing/taxes/${vat}`, { active: false })).statusCode).toBe(200);
    const taxes = (await call(sP, 'GET', '/billing/settings')).json().taxes as { name: string; active: boolean }[];
    expect(taxes.find((t) => t.name === 'VAT')!.active).toBe(false);
    expect((await call(sM, 'PATCH', `/billing/taxes/${vat}`, { active: true })).statusCode).toBe(403);
  });
});

describe('the fee for an engagement', () => {
  test('a manager on the team sets a flat fee or hourly basis with a budget', async () => {
    expect((await call(sM, 'GET', `/engagements/${eng}/fee`)).json()).toEqual({ fee: null });
    const flat = await call(sM, 'PUT', `/engagements/${eng}/fee`, { basis: 'flat', flatFee: '450000.00', budgetHours: 120, notes: 'Fixed fee agreed in the engagement letter' });
    expect(flat.statusCode).toBe(200);
    expect((await call(sM, 'GET', `/engagements/${eng}/fee`)).json().fee).toMatchObject({ basis: 'flat', flatFee: '450000.00', budgetHours: 120 });
    expect((await call(sM, 'PUT', `/engagements/${eng}/fee`, { basis: 'hourly', budgetHours: 200 })).statusCode).toBe(200);
    expect((await call(sM, 'GET', `/engagements/${eng}/fee`)).json().fee).toMatchObject({ basis: 'hourly', flatFee: null, budgetHours: 200 });
  });
  test('a flat basis needs an amount; bad values are refused', async () => {
    expect((await call(sM, 'PUT', `/engagements/${eng}/fee`, { basis: 'flat' })).statusCode).toBe(400);
    expect((await call(sM, 'PUT', `/engagements/${eng}/fee`, { basis: 'flat', flatFee: '-1' })).statusCode).toBe(400);
    expect((await call(sM, 'PUT', `/engagements/${eng}/fee`, { basis: 'hourly', budgetHours: -3 })).statusCode).toBe(400);
  });
  test('staff cannot see or set it; a manager not on the team cannot; a partner not on the team can read but not set', async () => {
    expect((await call(sF, 'GET', `/engagements/${eng}/fee`)).statusCode).toBe(403);
    expect((await call(sF, 'PUT', `/engagements/${eng}/fee`, { basis: 'hourly' })).statusCode).toBe(403);
    expect((await call(sM2, 'GET', `/engagements/${eng}/fee`)).statusCode).toBe(404);
    expect((await call(sM2, 'PUT', `/engagements/${eng}/fee`, { basis: 'hourly' })).statusCode).toBe(404);
    expect((await call(sA, 'GET', `/engagements/${eng}/fee`)).statusCode).toBe(404);
    const sPnon = await login(h, await makeUser(h, T.id, 'partner', 4));
    expect((await call(sPnon, 'GET', `/engagements/${eng}/fee`)).statusCode).toBe(200);
    expect([403, 404]).toContain((await call(sPnon, 'PUT', `/engagements/${eng}/fee`, { basis: 'hourly' })).statusCode);
  });
});

describe('changes are in the audit trail in plain English', () => {
  test('rates, taxes and settings read as sentences', async () => {
    const t = (await call(sP, 'GET', '/audit-trail?kind=changes&limit=200')).json().events as { sentence: string }[];
    const text = t.map((e) => e.sentence).join('\n');
    expect(text).toMatch(/set the hourly rate for staff to KES 1,500\.00/);
    expect(text).toMatch(/changed the hourly rate for staff from KES 1,500\.00 to KES 1,600\.00/);
    expect(text).toMatch(/added the tax VAT at 16\.00%/);
    expect(text).toMatch(/updated the invoice details of the firm/);
    expect(text).toMatch(/set the fee for Billable Ltd to a flat KES 450,000\.00/);
  });
});
