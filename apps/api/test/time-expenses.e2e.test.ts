import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, A: TestUser, M: TestUser, M2: TestUser, F: TestUser, OS: TestUser;
let sP: Session, sA: Session, sM: Session, sM2: Session, sF: Session, sOS: Session;
let eng: string;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const RANGE = 'from=2026-11-01&to=2026-11-30';
const entry = (over: object = {}) => ({ engagementId: eng, workDate: '2026-11-10', minutes: 120, description: 'Stock count at the warehouse', ...over });
const list = async (s: Session, extra = '') => (await call(s, 'GET', `/time?${RANGE}${extra}`)).json() as { entries: { id: string; userId: string; minutes: number; rate?: string; value?: string; billable: boolean; invoiced: boolean }[]; totals: { minutes: number; billableMinutes: number } };

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'timeexp');
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
  await call(sP, 'PUT', '/billing/rates', { rates: { staff: '1500.00', manager: '4000.00' } });
  const client = (await call(sM, 'POST', '/clients', { name: 'Timesheet Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  eng = (await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${eng}/members`, { userId: F.id });
});
afterAll(async () => h.close());

describe('logging time', () => {
  let id: string;
  test('a team member logs time on an engagement; the hourly rate is fixed at that moment', async () => {
    const r = await call(sF, 'POST', '/time', entry());
    expect(r.statusCode).toBe(201);
    id = r.json().id;
    const mine = await list(sF);
    expect(mine.entries).toHaveLength(1);
    expect(mine.totals).toMatchObject({ minutes: 120, billableMinutes: 120 });
    // The firm raises the staff rate afterwards: the entry keeps the rate it was logged at.
    await call(sP, 'PUT', '/billing/rates', { rates: { staff: '2000.00' } });
    const asManager = await list(sM);
    expect(asManager.entries[0]).toMatchObject({ rate: '1500.00', value: '3000.00' });
    await call(sP, 'PUT', '/billing/rates', { rates: { staff: '1500.00' } });
  });

  test('rates and values are not shown to the person who logged it', async () => {
    const mine = await list(sF);
    expect(mine.entries[0]!.rate).toBeUndefined();
    expect(mine.entries[0]!.value).toBeUndefined();
  });

  test('bad entries are refused', async () => {
    for (const bad of [{ minutes: 0 }, { minutes: 1441 }, { minutes: 1.5 }, { description: '' }, { workDate: '10 November' }, { workDate: '2026-02-30' }]) {
      expect((await call(sF, 'POST', '/time', entry(bad))).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  test('you can log only on engagements you are on; time without an engagement is internal and not billable', async () => {
    expect((await call(sOS, 'POST', '/time', entry())).statusCode).toBe(404);
    expect((await call(sF, 'POST', '/time', entry({ engagementId: undefined, description: 'Firm meeting', billable: true }))).statusCode).toBe(400);
    expect((await call(sF, 'POST', '/time', entry({ engagementId: undefined, description: 'Firm meeting', billable: false }))).statusCode).toBe(201);
    expect((await call(sA, 'POST', '/time', entry())).statusCode).toBe(403);
  });

  test('your own entry can be changed or deleted before it is invoiced', async () => {
    expect((await call(sF, 'PATCH', `/time/${id}`, { minutes: 90 })).statusCode).toBe(200);
    expect((await list(sF)).entries.find((e) => e.id === id)!.minutes).toBe(90);
    expect((await call(sF, 'PATCH', `/time/${id}`, { minutes: 0 })).statusCode).toBe(400);
    const other = (await call(sF, 'POST', '/time', entry({ description: 'To be removed', minutes: 15 }))).json().id as string;
    expect((await call(sF, 'DELETE', `/time/${other}`)).statusCode).toBe(200);
    expect((await list(sF)).entries.find((e) => e.id === other)).toBeUndefined();
  });

  test('nobody else can change your entry, not even a manager or a partner', async () => {
    for (const s of [sM, sP, sOS]) {
      expect([403, 404]).toContain((await call(s, 'PATCH', `/time/${id}`, { minutes: 5 })).statusCode);
      expect([403, 404]).toContain((await call(s, 'DELETE', `/time/${id}`)).statusCode);
    }
    expect((await list(sF)).entries.find((e) => e.id === id)!.minutes).toBe(90);
  });

  test('an invoiced entry is frozen', async () => {
    const frozen = (await call(sF, 'POST', '/time', entry({ description: 'Invoiced work', minutes: 30 }))).json().id as string;
    // Only the invoicing functions may attach an invoice: they switch this setting on inside their own transaction.
    const c = await h.owner.connect();
    try {
      await c.query('BEGIN');
      await c.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.invoicing', 'on', true)", [T.id, F.id]);
      await c.query('update time_entries set invoice_id = gen_random_uuid() where id = $1', [frozen]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    expect((await call(sF, 'PATCH', `/time/${frozen}`, { minutes: 5 })).statusCode).toBe(409);
    expect((await call(sF, 'DELETE', `/time/${frozen}`)).statusCode).toBe(409);
    expect((await list(sM)).entries.find((e) => e.id === frozen)!.invoiced).toBe(true);
  });
});

describe('who sees whose time', () => {
  test('staff see only their own; a manager sees the team of their engagements; partners see the firm; others see nothing', async () => {
    const ids = async (s: Session) => (await list(s)).entries.map((e) => e.userId);
    expect(new Set(await ids(sF))).toEqual(new Set([F.id]));
    expect(await ids(sOS)).toEqual([]);
    expect(await ids(sM)).toContain(F.id);
    expect(await ids(sM2)).toEqual([]);
    expect(await ids(sP)).toContain(F.id);
    expect((await call(sA, 'GET', `/time?${RANGE}`)).statusCode).toBe(403);
  });

  test('a manager can filter by person and engagement; the range is limited', async () => {
    expect((await list(sM, `&userId=${F.id}`)).entries.length).toBeGreaterThan(0);
    expect((await list(sM, `&userId=${M.id}`)).entries).toEqual([]);
    expect((await list(sM, `&engagementId=${eng}`)).entries.length).toBeGreaterThan(0);
    expect((await call(sF, 'GET', '/time?from=2025-01-01&to=2026-12-31')).statusCode).toBe(400);
    expect((await call(sF, 'GET', '/time')).statusCode).toBe(400);
  });
});

describe('expenses', () => {
  let id: string;
  const exp = (over: object = {}) => ({ engagementId: eng, spentOn: '2026-11-10', category: 'fuel', description: 'Fuel to the client premises', amount: '5000.00', rebillable: true, ...over });

  test('a team member records an expense; managers and partners see it, other staff do not', async () => {
    const r = await call(sF, 'POST', '/expenses', exp());
    expect(r.statusCode).toBe(201);
    id = r.json().id;
    const get = async (s: Session) => (await call(s, 'GET', `/expenses?${RANGE}`)).json().expenses as { id: string; amount: string; userName: string }[];
    expect((await get(sF)).map((e) => e.id)).toContain(id);
    expect((await get(sM)).find((e) => e.id === id)).toMatchObject({ amount: '5000.00' });
    expect((await get(sP)).map((e) => e.id)).toContain(id);
    expect((await get(sOS)).map((e) => e.id)).not.toContain(id);
    expect((await get(sM2)).map((e) => e.id)).not.toContain(id);
  });

  test('bad expenses are refused, including a receipt that is not evidence of this engagement', async () => {
    for (const bad of [{ amount: '0' }, { amount: '-5' }, { amount: 'much' }, { category: 'holiday' }, { description: '' }, { spentOn: 'yesterday' }]) {
      expect((await call(sF, 'POST', '/expenses', exp(bad))).statusCode, JSON.stringify(bad)).toBe(400);
    }
    const paper = (await call(sF, 'POST', `/engagements/${eng}/items`, { kind: 'workpaper', title: 'Not a receipt', content: {} })).json().id;
    expect((await call(sF, 'POST', '/expenses', exp({ receiptItemId: paper }))).statusCode).toBe(422);
    expect((await call(sF, 'POST', '/expenses', exp({ receiptItemId: '00000000-0000-4000-8000-000000000000' }))).statusCode).toBe(422);
    expect((await call(sOS, 'POST', '/expenses', exp())).statusCode).toBe(404);
  });

  test('only the person who recorded it can change or delete it', async () => {
    expect((await call(sF, 'PATCH', `/expenses/${id}`, { amount: '5500.00' })).statusCode).toBe(200);
    expect([403, 404]).toContain((await call(sM, 'PATCH', `/expenses/${id}`, { amount: '1.00' })).statusCode);
    expect((await call(sF, 'DELETE', `/expenses/${id}`)).statusCode).toBe(200);
  });
});
