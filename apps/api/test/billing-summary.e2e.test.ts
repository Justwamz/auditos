import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, A: TestUser, M: TestUser, M2: TestUser, F: TestUser, G: TestUser;
let sP: Session, sA: Session, sM: Session, sM2: Session, sF: Session, sG: Session;
let engA: string;
let engB: string;
let clientA: string;
let vat: string;

type Method = 'GET' | 'POST' | 'PUT';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const RANGE = 'from=2026-11-01&to=2026-11-30';
const summary = async (s: Session) => (await call(s, 'GET', `/billing/summary?${RANGE}`)).json();

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'summary');
  P = await makeUser(h, T.id, 'partner', 4);
  A = await makeUser(h, T.id, 'firm_admin', 0);
  M = await makeUser(h, T.id, 'manager', 3);
  M2 = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  G = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sA = await login(h, A);
  sM = await login(h, M);
  sM2 = await login(h, M2);
  sF = await login(h, F);
  sG = await login(h, G);
  for (const s of [sP, sM, sM2, sF, sG]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  await call(sP, 'PUT', '/billing/settings', { invoicePrefix: 'KA', paymentTermsDays: 30 });
  await call(sP, 'PUT', '/billing/rates', { rates: { staff: '1500.00' } });
  vat = (await call(sP, 'POST', '/billing/taxes', { name: 'VAT', rate: '16' })).json().id;
  clientA = (await call(sM, 'POST', '/clients', { name: 'Summary A Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  const clientB = (await call(sM2, 'POST', '/clients', { name: 'Summary B Ltd', sector: 'rental', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  engA = (await call(sM, 'POST', '/engagements', { clientId: clientA, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  engB = (await call(sM2, 'POST', '/engagements', { clientId: clientB, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${engA}/members`, { userId: F.id });
  await call(sM2, 'POST', `/engagements/${engB}/members`, { userId: G.id });
  await call(sM, 'PUT', `/engagements/${engA}/fee`, { basis: 'flat', flatFee: '450000.00', budgetHours: 100 });
  const log = (s: Session, body: object) => call(s, 'POST', '/time', { workDate: '2026-11-10', description: 'Work', ...body });
  await log(sF, { engagementId: engA, minutes: 120 });
  await log(sF, { minutes: 60, billable: false, description: 'Firm training' });
  await log(sG, { engagementId: engB, minutes: 180 });
  await call(sF, 'POST', '/expenses', { engagementId: engA, spentOn: '2026-11-10', category: 'fuel', description: 'Fuel', amount: '5000.00', rebillable: true });
  await call(sM, 'POST', '/prospects', { name: 'Pipeline Co', sector: 'trading', expectedFee: '300000.00' });
});
afterAll(async () => h.close());

describe('what each person gets', () => {
  test('staff see their own hours and nothing about rates, values, other people or the firm', async () => {
    const s = await summary(sF);
    expect(s.mine).toMatchObject({ minutes: 180, billableMinutes: 120, utilisation: 67 });
    expect(Object.keys(s).sort()).toEqual(['mine', 'range']);
  });

  test('a manager sees the time and work in progress of their own engagements, with values', async () => {
    const s = await summary(sM);
    expect(s.time).toMatchObject({ minutes: 120, billableMinutes: 120, value: '3000.00', utilisation: 100 });
    expect(s.time.byPerson.map((p: { name: string; minutes: number }) => p.minutes)).toEqual([120]);
    expect(s.time.byEngagement).toHaveLength(1);
    expect(s.time.byEngagement[0]).toMatchObject({ engagementId: engA, clientName: 'Summary A Ltd', minutes: 120, value: '3000.00', feeBasis: 'flat', flatFee: '450000.00', budgetHours: 100, hoursUsed: 2, budgetUsedPercent: 2 });
    expect(s.wip).toEqual({ time: '3000.00', expenses: '5000.00', total: '8000.00' });
  });

  test('another manager sees only theirs', async () => {
    const s = await summary(sM2);
    expect(s.time).toMatchObject({ minutes: 180, value: '4500.00' });
    expect(s.time.byEngagement.map((e: { engagementId: string }) => e.engagementId)).toEqual([engB]);
    expect(s.wip.expenses).toBe('0.00');
  });

  test('a partner sees the whole firm, including time that belongs to no engagement', async () => {
    const s = await summary(sP);
    expect(s.time).toMatchObject({ minutes: 360, billableMinutes: 300, value: '7500.00', utilisation: 83 });
    expect(s.time.byPerson).toHaveLength(2);
    expect(s.wip).toEqual({ time: '7500.00', expenses: '5000.00', total: '12500.00' });
    expect(s.pipeline.open).toEqual({ count: 1, value: '300000.00' });
  });

  test('the administrator sees invoicing only, never time, work in progress or the pipeline', async () => {
    const s = await summary(sA);
    expect(s.invoicing).toBeDefined();
    expect(s.time).toBeUndefined();
    expect(s.wip).toBeUndefined();
    expect(s.pipeline).toBeUndefined();
  });
});

describe('invoicing figures', () => {
  let inv: string;
  beforeAll(async () => {
    inv = (await call(sM, 'POST', '/invoices', { clientId: clientA, taxIds: [vat], lines: [{ description: 'Audit fee', quantity: '1', unitPrice: '10000.00' }] })).json().id;
    await call(sP, 'POST', `/invoices/${inv}/issue`);
    await call(sP, 'POST', `/invoices/${inv}/payments`, { amount: '4000.00', paidOn: new Date().toISOString().slice(0, 10), method: 'bank' });
    await call(sM, 'POST', '/invoices', { clientId: clientA, lines: [{ description: 'Draft only', quantity: '1', unitPrice: '1.00' }] });
  });

  const today = new Date().toISOString().slice(0, 10);
  const wide = `from=${today.slice(0, 4)}-01-01&to=${today.slice(0, 4)}-12-31`;

  test('issued, collected, outstanding and drafts, in KES', async () => {
    const s = (await call(sP, 'GET', `/billing/summary?${wide}`)).json();
    expect(s.invoicing.issued).toEqual({ count: 1, total: '11600.00' });
    expect(s.invoicing.collected).toBe('4000.00');
    expect(s.invoicing.outstanding).toEqual({ count: 1, total: '7600.00' });
    expect(s.invoicing.overdue).toEqual({ count: 0, total: '0.00' });
    expect(s.invoicing.drafts).toBe(1);
  });

  test('a manager sees the invoices of their engagements and the ones they made; another manager sees none', async () => {
    expect((await call(sM, 'GET', `/billing/summary?${wide}`)).json().invoicing.drafts).toBe(1);
    expect((await call(sM2, 'GET', `/billing/summary?${wide}`)).json().invoicing.issued).toEqual({ count: 0, total: '0.00' });
  });

  test('an invoice past its due date counts as overdue', async () => {
    const c = await h.owner.connect();
    try {
      await c.query('BEGIN');
      await c.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.invoicing', 'on', true)", [T.id, P.id]);
      await c.query("update invoices set due_date = (now() at time zone 'Africa/Nairobi')::date - 3 where id = $1", [inv]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    const s = (await call(sP, 'GET', `/billing/summary?${wide}`)).json();
    expect(s.invoicing.overdue).toEqual({ count: 1, total: '7600.00' });
  });
});

describe('the range', () => {
  test('time outside the range is not counted; a bad or huge range is refused', async () => {
    const s = (await call(sP, 'GET', '/billing/summary?from=2025-01-01&to=2025-01-31')).json();
    expect(s.time).toMatchObject({ minutes: 0, value: '0.00' });
    expect((await call(sP, 'GET', '/billing/summary?from=2026-12-31&to=2026-01-01')).statusCode).toBe(400);
    expect((await call(sP, 'GET', '/billing/summary?from=2020-01-01&to=2026-12-31')).statusCode).toBe(400);
    expect((await call(sP, 'GET', '/billing/summary')).statusCode).toBe(400);
  });
});
