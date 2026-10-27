import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, A: TestUser, M1: TestUser, M2: TestUser, S1: TestUser, S2: TestUser;
let sP: Session, sA: Session, sM1: Session, sM2: Session, sS1: Session, sS2: Session;
let c1: string;
let c2: string;

const call = (s: Session, method: 'GET' | 'POST', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const names = async (s: Session) => ((await call(s, 'GET', '/clients')).json().clients as { name: string }[]).map((c) => c.name).sort();
const clientBody = (name: string, extra: object = {}) => ({ name, sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12, ...extra });

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'clientaccess');
  P = await makeUser(h, T.id, 'partner', 4);
  A = await makeUser(h, T.id, 'firm_admin', 0);
  M1 = await makeUser(h, T.id, 'manager', 3);
  M2 = await makeUser(h, T.id, 'manager', 3);
  S1 = await makeUser(h, T.id, 'staff', 1);
  S2 = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sA = await login(h, A);
  sM1 = await login(h, M1);
  sM2 = await login(h, M2);
  sS1 = await login(h, S1);
  sS2 = await login(h, S2);
  for (const s of [sP, sM1, sM2, sS1]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  c1 = (await call(sM1, 'POST', '/clients', clientBody('Alpha Traders Ltd'))).json().id;
  c2 = (await call(sM2, 'POST', '/clients', clientBody('Beta Rentals Ltd'))).json().id;
});
afterAll(async () => h.close());

describe('who sees which client', () => {
  test('partners and the admin see every client', async () => {
    expect(await names(sP)).toEqual(['Alpha Traders Ltd', 'Beta Rentals Ltd']);
    expect(await names(sA)).toEqual(['Alpha Traders Ltd', 'Beta Rentals Ltd']);
  });

  test('a manager sees only the clients they manage', async () => {
    expect(await names(sM1)).toEqual(['Alpha Traders Ltd']);
    expect(await names(sM2)).toEqual(['Beta Rentals Ltd']);
  });

  test('unassigned staff see no clients, and get 404 on a client by id', async () => {
    expect(await names(sS2)).toEqual([]);
    expect((await call(sS2, 'GET', `/clients/${c1}`)).statusCode).toBe(404);
    expect((await call(sM2, 'GET', `/clients/${c1}`)).statusCode).toBe(404);
  });

  test('staff see a client once they are on one of its engagements, and only that client', async () => {
    const e = await call(sM1, 'POST', '/engagements', { clientId: c1, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id });
    expect(e.statusCode).toBe(201);
    expect((await call(sM1, 'POST', `/engagements/${e.json().id}/members`, { userId: S1.id })).statusCode).toBe(201);
    expect(await names(sS1)).toEqual(['Alpha Traders Ltd']);
    expect((await call(sS1, 'GET', `/clients/${c1}`)).statusCode).toBe(200);
    expect((await call(sS1, 'GET', `/clients/${c2}`)).statusCode).toBe(404);
  });

  test('a manager creating an engagement for a client they cannot see gets not found', async () => {
    const e = await call(sM1, 'POST', '/engagements', { clientId: c2, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id });
    expect(e.statusCode).toBe(404);
  });

  test('the client detail shows the account manager and the engagements the viewer can see', async () => {
    const r = (await call(sP, 'GET', `/clients/${c1}`)).json();
    expect(r).toMatchObject({ name: 'Alpha Traders Ltd', accountManagerId: M1.id });
    expect(typeof r.accountManagerName).toBe('string');
    expect(Array.isArray(r.engagements)).toBe(true);
  });
});

describe('the account manager', () => {
  test('defaults to the manager or partner who creates the client', async () => {
    const list = (await call(sP, 'GET', '/clients')).json().clients as { name: string; accountManagerId: string }[];
    expect(list.find((c) => c.name === 'Alpha Traders Ltd')!.accountManagerId).toBe(M1.id);
  });

  test('can be another active manager or partner, and then that person sees the client', async () => {
    const r = await call(sM1, 'POST', '/clients', clientBody('Gamma Farms Ltd', { accountManagerId: M2.id }));
    expect(r.statusCode).toBe(201);
    expect(await names(sM2)).toContain('Gamma Farms Ltd');
    expect(await names(sM1)).not.toContain('Gamma Farms Ltd');
  });

  test('cannot be staff, a firm admin, someone outside the firm, or missing', async () => {
    expect((await call(sM1, 'POST', '/clients', clientBody('Delta Ltd', { accountManagerId: S1.id }))).statusCode).toBe(400);
    expect((await call(sM1, 'POST', '/clients', clientBody('Delta Ltd', { accountManagerId: A.id }))).statusCode).toBe(400);
    expect((await call(sM1, 'POST', '/clients', clientBody('Delta Ltd', { accountManagerId: '00000000-0000-4000-8000-000000000000' }))).statusCode).toBe(400);
    expect(await names(sP)).not.toContain('Delta Ltd');
  });
});
