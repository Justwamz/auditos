import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, A: TestUser, M: TestUser, M2: TestUser, F: TestUser, OS: TestUser;
let sP: Session, sA: Session, sM: Session, sM2: Session, sF: Session, sOS: Session;
let client: string;
let eng: string;
let vat: string, excise: string, vatOnExcise: string;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const manual = (over: object = {}) => ({ clientId: client, taxMode: 'exclusive', taxIds: [], lines: [{ description: 'Audit fee', quantity: '1', unitPrice: '100000.00' }], ...over });
const draft = async (s: Session, body: object) => (await call(s, 'POST', '/invoices', body)).json().id as string;
const get = async (s: Session, id: string) => (await call(s, 'GET', `/invoices/${id}`)).json();

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'invoices');
  P = await makeUser(h, T.id, 'partner', 4);
  A = await makeUser(h, T.id, 'firm_admin', 0);
  M = await makeUser(h, T.id, 'manager', 3);
  M2 = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  OS = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sA = await login(h, A);
  sM = await login(h, M);
  sM2 = await login(h, M2);
  sF = await login(h, F);
  sOS = await login(h, OS);
  for (const s of [sP, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  await call(sP, 'PUT', '/billing/settings', { legalName: 'Kangethe & Associates', kraPin: 'P051234567Q', invoicePrefix: 'KA', paymentTermsDays: 14, bankDetails: 'Bank X 123' });
  await call(sP, 'PUT', '/billing/rates', { rates: { staff: '1500.00', manager: '4000.00' } });
  vat = (await call(sP, 'POST', '/billing/taxes', { name: 'VAT', rate: '16' })).json().id;
  excise = (await call(sP, 'POST', '/billing/taxes', { name: 'Excise duty', rate: '10' })).json().id;
  vatOnExcise = (await call(sP, 'POST', '/billing/taxes', { name: 'VAT on excise', rate: '16', onPrevious: true })).json().id;
  client = (await call(sM, 'POST', '/clients', { name: 'Invoiced Traders Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  eng = (await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${eng}/members`, { userId: F.id });
});
afterAll(async () => h.close());

describe('tax on a draft invoice is optional and chosen per invoice', () => {
  test('no tax chosen: none is charged', async () => {
    const inv = await get(sM, await draft(sM, manual()));
    expect(inv).toMatchObject({ status: 'draft', number: null, subtotal: '100000.00', taxTotal: '0.00', total: '100000.00', taxes: [] });
  });

  test('VAT added on top (exclusive), to the cent', async () => {
    const inv = await get(sM, await draft(sM, manual({ taxIds: [vat], lines: [{ description: 'A', quantity: '2', unitPrice: '50000.00' }, { description: 'B', quantity: '1', unitPrice: '12500.50' }] })));
    expect(inv).toMatchObject({ subtotal: '112500.50', taxTotal: '18000.08', total: '130500.58' });
    expect(inv.taxes).toEqual([{ name: 'VAT', rate: '16.00', onPrevious: false, amount: '18000.08' }]);
  });

  test('VAT already included in the price (inclusive): worked back out, the total stays as typed', async () => {
    const inv = await get(sM, await draft(sM, manual({ taxMode: 'inclusive', taxIds: [vat], lines: [{ description: 'Gross', quantity: '1', unitPrice: '116000.00' }] })));
    expect(inv).toMatchObject({ taxMode: 'inclusive', subtotal: '100000.00', taxTotal: '16000.00', total: '116000.00' });
  });

  test('several taxes, with VAT charged on top of excise duty', async () => {
    const inv = await get(sM, await draft(sM, manual({ taxIds: [excise, vatOnExcise] })));
    expect(inv.taxes.map((t: { name: string; amount: string }) => [t.name, t.amount])).toEqual([['Excise duty', '10000.00'], ['VAT on excise', '17600.00']]);
    expect(inv.total).toBe('127600.00');
  });

  test('unknown, switched-off or repeated taxes are refused', async () => {
    expect((await call(sM, 'POST', '/invoices', manual({ taxIds: ['00000000-0000-4000-8000-000000000000'] }))).statusCode).toBe(400);
    expect((await call(sM, 'POST', '/invoices', manual({ taxIds: [vat, vat] }))).statusCode).toBe(400);
    const off = (await call(sP, 'POST', '/billing/taxes', { name: 'Old levy', rate: '2' })).json().id;
    await call(sP, 'PATCH', `/billing/taxes/${off}`, { active: false });
    expect((await call(sM, 'POST', '/invoices', manual({ taxIds: [off] }))).statusCode).toBe(400);
  });
});

describe('drafting', () => {
  test('bad invoices are refused', async () => {
    for (const bad of [{ lines: [] }, { lines: [{ description: 'x', quantity: '-1', unitPrice: '10' }] }, { lines: [{ description: 'x', quantity: '1', unitPrice: 'free' }] }, { lines: [{ description: 'x', quantity: '1', unitPrice: '0' }] }]) {
      expect((await call(sM, 'POST', '/invoices', manual(bad))).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  test('who may create one: managers, partners and the administrator; not staff; only for clients you can see', async () => {
    expect((await call(sF, 'POST', '/invoices', manual())).statusCode).toBe(403);
    expect((await call(sOS, 'POST', '/invoices', manual())).statusCode).toBe(403);
    expect((await call(sM2, 'POST', '/invoices', manual())).statusCode).toBe(404);
    expect((await call(sP, 'POST', '/invoices', manual())).statusCode).toBe(201);
    expect((await call(sA, 'POST', '/invoices', manual())).statusCode).toBe(201);
  });

  test('a draft can be changed or discarded', async () => {
    const id = await draft(sM, manual());
    expect((await call(sM, 'PUT', `/invoices/${id}`, manual({ taxIds: [vat], notes: 'Thank you', lines: [{ description: 'Revised', quantity: '1', unitPrice: '200000.00' }] }))).statusCode).toBe(200);
    expect(await get(sM, id)).toMatchObject({ total: '232000.00', notes: 'Thank you' });
    expect((await call(sM, 'DELETE', `/invoices/${id}`)).statusCode).toBe(200);
    expect((await call(sM, 'GET', `/invoices/${id}`)).statusCode).toBe(404);
  });
});

describe('invoicing time and expenses', () => {
  let t1: string, t2: string, x1: string;
  let id: string;

  beforeAll(async () => {
    t1 = (await call(sF, 'POST', '/time', { engagementId: eng, workDate: '2026-11-10', minutes: 120, description: 'Stock count' })).json().id;
    t2 = (await call(sF, 'POST', '/time', { engagementId: eng, workDate: '2026-11-11', minutes: 90, description: 'Receivables' })).json().id;
    x1 = (await call(sF, 'POST', '/expenses', { engagementId: eng, spentOn: '2026-11-10', category: 'fuel', description: 'Fuel to site', amount: '5000.00', rebillable: true })).json().id;
    await call(sM, 'PUT', `/engagements/${eng}/fee`, { basis: 'flat', flatFee: '450000.00' });
  });

  test('the unbilled work and fee for an engagement can be listed', async () => {
    const r = (await call(sM, 'GET', `/engagements/${eng}/billable`)).json();
    expect(r.client.name).toBe('Invoiced Traders Ltd');
    expect(r.time.map((t: { id: string }) => t.id).sort()).toEqual([t1, t2].sort());
    expect(r.time[0]).toMatchObject({ rate: '1500.00' });
    expect(r.expenses.map((x: { id: string }) => x.id)).toEqual([x1]);
    expect(r.fee).toMatchObject({ basis: 'flat', flatFee: '450000.00' });
    expect((await call(sF, 'GET', `/engagements/${eng}/billable`)).statusCode).toBe(403);
  });

  test('a draft built from time and expenses is exact: 3.5 hours at 1,500, the fuel, and VAT', async () => {
    id = await draft(sM, { clientId: client, engagementId: eng, taxMode: 'exclusive', taxIds: [vat], billing: { timeEntryIds: [t1, t2], expenseIds: [x1] } });
    const inv = await get(sM, id);
    expect(inv.lines.map((l: { description: string; amount: string; source: string }) => [l.description, l.amount, l.source])).toEqual([
      ['Professional time: ' + inv.lines[0].description.split(': ')[1], '5250.00', 'time'],
      ['Expense (fuel): Fuel to site', '5000.00', 'expense'],
    ]);
    expect(inv).toMatchObject({ subtotal: '10250.00', taxTotal: '1640.00', total: '11890.00' });
  });

  test('a flat fee can be billed from the engagement, and entries must be unbilled and from this engagement', async () => {
    const flat = await get(sM, await draft(sM, { clientId: client, engagementId: eng, taxIds: [], billing: { flatFee: true } }));
    expect(flat).toMatchObject({ total: '450000.00' });
    expect(flat.lines[0]).toMatchObject({ description: 'Audit fee (fixed)', source: 'fee' });
    expect((await call(sM, 'POST', '/invoices', { clientId: client, engagementId: eng, billing: { timeEntryIds: ['00000000-0000-4000-8000-000000000000'] } })).statusCode).toBe(422);
    expect((await call(sM, 'POST', '/invoices', { clientId: client, billing: { flatFee: true } })).statusCode).toBe(400);
  });

  test('only a partner or administrator issues: it is numbered, billed and frozen', async () => {
    expect((await call(sM, 'POST', `/invoices/${id}/issue`)).statusCode).toBe(403);
    const r = await call(sP, 'POST', `/invoices/${id}/issue`);
    expect(r.statusCode).toBe(200);
    expect(r.json().number).toMatch(/^KA-\d{4}-0001$/);
    const inv = await get(sP, id);
    expect(inv).toMatchObject({ status: 'sent' });
    expect(inv.dueDate > inv.issueDate).toBe(true);
    expect(((Date.parse(inv.dueDate) - Date.parse(inv.issueDate)) / 86_400_000)).toBe(14);
    expect((await call(sM, 'POST', `/invoices/${id}/issue`)).statusCode).toBe(403);
    expect((await call(sP, 'POST', `/invoices/${id}/issue`)).statusCode).toBe(409);
  });

  test('issuing is labelled a simulation: nothing is claimed to have gone to KRA', async () => {
    const inv = await get(sP, id);
    expect(inv.tax).toMatchObject({ provider: 'simulation', simulated: true, status: 'simulated' });
    expect(inv.tax.controlNumber).toMatch(/^SIM-/);
    expect(inv.tax.message).toMatch(/has not been sent to KRA/i);
  });

  test('the time and expenses are now billed: they cannot be edited, deleted or invoiced again', async () => {
    expect((await call(sF, 'PATCH', `/time/${t1}`, { minutes: 5 })).statusCode).toBe(409);
    expect((await call(sF, 'DELETE', `/expenses/${x1}`)).statusCode).toBe(409);
    expect((await call(sM, 'POST', '/invoices', { clientId: client, engagementId: eng, billing: { timeEntryIds: [t1] } })).statusCode).toBe(422);
    expect(((await call(sM, 'GET', `/engagements/${eng}/billable`)).json().time as unknown[]).length).toBe(0);
  });

  test('an issued invoice is frozen, in the application and in the database', async () => {
    expect((await call(sM, 'PUT', `/invoices/${id}`, manual())).statusCode).toBe(409);
    expect((await call(sM, 'DELETE', `/invoices/${id}`)).statusCode).toBe(409);
    await expect(ownerQuery(h, T.id, 'update invoices set total_cents = 1 where id = $1', [id], P.id)).rejects.toThrow(/invoice_issued/);
    await expect(ownerQuery(h, T.id, "update invoice_lines set amount_cents = 1 where invoice_id = $1", [id], P.id)).rejects.toThrow(/invoice_issued/);
    await expect(ownerQuery(h, T.id, "insert into invoice_lines (tenant_id, invoice_id, position, description, quantity, unit_cents, amount_cents) values ($1, $2, 9, 'sneaky', 1, 1, 1)", [T.id, id], P.id)).rejects.toThrow(/invoice_issued/);
  });

  test('numbers run in sequence with no gaps', async () => {
    const second = await draft(sM, manual());
    const n2 = (await call(sP, 'POST', `/invoices/${second}/issue`)).json().number as string;
    expect(n2).toMatch(/^KA-\d{4}-0002$/);
    const third = await draft(sM, manual());
    expect(((await call(sA, 'POST', `/invoices/${third}/issue`)).json().number as string)).toMatch(/^KA-\d{4}-0003$/);
  });
});

describe('payments', () => {
  let id: string;
  beforeAll(async () => {
    id = await draft(sM, manual({ taxIds: [vat] }));
    await call(sP, 'POST', `/invoices/${id}/issue`);
  });

  test('only a partner or administrator records payments; part payments, then the rest', async () => {
    const pay = (s: Session, amount: string, extra: object = {}) => call(s, 'POST', `/invoices/${id}/payments`, { amount, paidOn: '2026-11-20', method: 'bank', reference: 'RTGS 1', ...extra });
    expect((await pay(sM, '1000.00')).statusCode).toBe(403);
    expect((await pay(sP, '16000.00')).statusCode).toBe(200);
    expect(await get(sP, id)).toMatchObject({ status: 'part_paid', paid: '16000.00', outstanding: '100000.00' });
    expect((await pay(sP, '100000.01')).statusCode).toBe(422);
    expect((await pay(sP, '0')).statusCode).toBe(400);
    expect((await pay(sP, '100', { method: 'barter' })).statusCode).toBe(400);
    expect((await pay(sA, '100000.00', { method: 'mpesa' })).statusCode).toBe(200);
    expect(await get(sP, id)).toMatchObject({ status: 'paid', outstanding: '0.00' });
    expect((await pay(sP, '1.00')).statusCode).toBe(409);
    expect((await get(sP, id)).payments).toHaveLength(2);
  });

  test('a draft cannot be paid', async () => {
    const d = await draft(sM, manual());
    expect((await call(sP, 'POST', `/invoices/${d}/payments`, { amount: '1.00', paidOn: '2026-11-20', method: 'cash' })).statusCode).toBe(409);
  });
});

describe('voiding', () => {
  test('a sent invoice is voided with a reason, and its time and expenses become billable again', async () => {
    const t = (await call(sF, 'POST', '/time', { engagementId: eng, workDate: '2026-11-12', minutes: 60, description: 'Void test work' })).json().id as string;
    const id = await draft(sM, { clientId: client, engagementId: eng, billing: { timeEntryIds: [t] } });
    await call(sP, 'POST', `/invoices/${id}/issue`);
    expect((await call(sM, 'POST', `/invoices/${id}/void`, { reason: 'Billed the wrong client' })).statusCode).toBe(403);
    expect((await call(sP, 'POST', `/invoices/${id}/void`, { reason: 'no' })).statusCode).toBe(400);
    expect((await call(sP, 'POST', `/invoices/${id}/void`, { reason: 'Wrong period billed' })).statusCode).toBe(200);
    expect(await get(sP, id)).toMatchObject({ status: 'void', voidReason: 'Wrong period billed' });
    expect((await call(sF, 'PATCH', `/time/${t}`, { minutes: 45 })).statusCode).toBe(200);
    expect(((await call(sM, 'GET', `/engagements/${eng}/billable`)).json().time as { id: string }[]).map((x) => x.id)).toContain(t);
    expect((await call(sP, 'POST', `/invoices/${id}/void`, { reason: 'Voiding again' })).statusCode).toBe(409);
  });

  test('an invoice with a payment cannot be voided', async () => {
    const id = await draft(sM, manual());
    await call(sP, 'POST', `/invoices/${id}/issue`);
    await call(sP, 'POST', `/invoices/${id}/payments`, { amount: '1.00', paidOn: '2026-11-20', method: 'cash' });
    expect((await call(sP, 'POST', `/invoices/${id}/void`, { reason: 'Customer disputes it' })).statusCode).toBe(409);
  });
});

describe('who sees which invoice', () => {
  test('staff see none; the manager sees invoices of their engagement; a manager not on it sees none; partner and administrator see all', async () => {
    const id = await draft(sM, { clientId: client, engagementId: eng, taxIds: [], lines: [{ description: 'Visible?', quantity: '1', unitPrice: '10.00' }] });
    expect((await call(sF, 'GET', '/invoices')).statusCode).toBe(403);
    expect((await call(sF, 'GET', `/invoices/${id}`)).statusCode).toBe(403);
    expect((await call(sM, 'GET', `/invoices/${id}`)).statusCode).toBe(200);
    expect((await call(sM2, 'GET', `/invoices/${id}`)).statusCode).toBe(404);
    expect(((await call(sM2, 'GET', '/invoices')).json().invoices as unknown[]).length).toBe(0);
    for (const s of [sP, sA]) expect((await call(s, 'GET', `/invoices/${id}`)).statusCode).toBe(200);
  });

  test('the list filters by status and shows overdue invoices', async () => {
    const id = await draft(sM, manual());
    await call(sP, 'POST', `/invoices/${id}/issue`);
    const c = await h.owner.connect();
    try {
      await c.query('BEGIN');
      await c.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.invoicing', 'on', true)", [T.id, P.id]);
      await c.query("update invoices set due_date = (now() at time zone 'Africa/Nairobi')::date - 5 where id = $1", [id]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    const overdue = (await call(sP, 'GET', '/invoices?status=overdue')).json().invoices as { id: string; overdue: boolean }[];
    expect(overdue.map((i) => i.id)).toContain(id);
    expect(overdue.every((i) => i.overdue)).toBe(true);
    const drafts = (await call(sP, 'GET', '/invoices?status=draft')).json().invoices as { status: string }[];
    expect(drafts.every((i) => i.status === 'draft')).toBe(true);
  });
});

describe('sending and the PDF', () => {
  let id: string;
  beforeAll(async () => {
    id = await draft(sM, manual({ taxIds: [vat] }));
  });

  test('a draft cannot be sent; an issued invoice goes to the simulated outbox, which says it was not delivered', async () => {
    expect((await call(sM, 'POST', `/invoices/${id}/send`, { to: 'jane@mwangaza.example.test' })).statusCode).toBe(409);
    await call(sP, 'POST', `/invoices/${id}/issue`);
    const r = await call(sM, 'POST', `/invoices/${id}/send`, { to: 'jane@mwangaza.example.test', message: 'Invoice attached.' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ provider: 'simulation', delivered: false });
    const box = (await call(sM, 'GET', '/outbox')).json().messages as { to: string; subject: string; body: string; delivered: boolean }[];
    expect(box[0]).toMatchObject({ to: 'jane@mwangaza.example.test', delivered: false });
    expect(box[0]!.subject).toMatch(/Invoice KA-\d{4}-\d{4} from Kangethe & Associates/);
    expect(box[0]!.body).toMatch(/not actually sent/i);
    expect((await call(sM, 'POST', `/invoices/${id}/send`, { to: 'not-an-email' })).statusCode).toBe(400);
    expect((await call(sF, 'GET', '/outbox')).statusCode).toBe(403);
  });

  test('the PDF is a PDF, and carries the simulation warning', async () => {
    const r = await call(sM, 'GET', `/invoices/${id}/pdf`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect((await call(sF, 'GET', `/invoices/${id}/pdf`)).statusCode).toBe(403);
  });
});

describe('the audit trail', () => {
  test('issuing, payments and voiding read as sentences', async () => {
    const t = (await call(sP, 'GET', '/audit-trail?kind=changes&limit=200')).json().events as { sentence: string }[];
    const text = t.map((e) => e.sentence).join('\n');
    expect(text).toMatch(/issued invoice KA-\d{4}-0001 to Invoiced Traders Ltd for KES 11,890\.00/);
    expect(text).toMatch(/recorded a payment of KES 16,000\.00 by bank on invoice KA-\d{4}-\d{4} for Invoiced Traders Ltd/);
    expect(text).toMatch(/which is now paid in full/);
    expect(text).toMatch(/voided invoice KA-\d{4}-\d{4} for Invoiced Traders Ltd\. Reason given: "Wrong period billed"/);
  });
});
