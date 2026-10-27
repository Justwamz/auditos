import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, A: TestUser, M1: TestUser, M2: TestUser, S1: TestUser, S2: TestUser;
let sP: Session, sA: Session, sM1: Session, sM2: Session, sS1: Session, sS2: Session;

type Method = 'GET' | 'POST' | 'PATCH';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const clientBody = (name: string, extra: object = {}) => ({ name, sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12, ...extra });
const names = async (s: Session) => ((await call(s, 'GET', '/clients')).json().clients as { name: string }[]).map((c) => c.name).sort();

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'handover');
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
});
afterAll(async () => h.close());

describe('changing a client\'s account manager', () => {
  let client: string;
  beforeAll(async () => {
    client = (await call(sM1, 'POST', '/clients', clientBody('Reassign Ltd'))).json().id;
  });

  test('only a partner or someone with the administrator permission may do it, with a reason', async () => {
    for (const s of [sM1, sM2, sS1]) {
      expect((await call(s, 'POST', `/clients/${client}/account-manager`, { userId: M2.id, reason: 'Workload balancing' })).statusCode, 'non-partner').toBe(403);
    }
    expect((await call(sP, 'POST', `/clients/${client}/account-manager`, { userId: M2.id })).statusCode).toBe(400);
    expect((await call(sP, 'POST', `/clients/${client}/account-manager`, { userId: M2.id, reason: 'no' })).statusCode).toBe(400);
  });

  test('the new manager must be an active manager or partner', async () => {
    expect((await call(sP, 'POST', `/clients/${client}/account-manager`, { userId: S1.id, reason: 'Staff should not manage' })).statusCode).toBe(400);
    expect((await call(sP, 'POST', `/clients/${client}/account-manager`, { userId: A.id, reason: 'Admin should not manage' })).statusCode).toBe(400);
    expect((await call(sP, 'POST', `/clients/${client}/account-manager`, { userId: '00000000-0000-4000-8000-000000000000', reason: 'Nobody there' })).statusCode).toBe(400);
  });

  test('a partner reassigns: the old manager loses the client, the new one gains it', async () => {
    expect(await names(sM1)).toContain('Reassign Ltd');
    expect(await names(sM2)).not.toContain('Reassign Ltd');
    const r = await call(sP, 'POST', `/clients/${client}/account-manager`, { userId: M2.id, reason: 'Daniel is moving to the Savannah audit' });
    expect(r.statusCode).toBe(200);
    expect(await names(sM1)).not.toContain('Reassign Ltd');
    expect(await names(sM2)).toContain('Reassign Ltd');
    expect(((await call(sM2, 'GET', '/clients')).json().clients as { name: string; accountManagerId: string }[]).find((c) => c.name === 'Reassign Ltd')!.accountManagerId).toBe(M2.id);
  });

  test('a firm administrator may do it too, and it reads as a sentence with the reason', async () => {
    expect((await call(sA, 'POST', `/clients/${client}/account-manager`, { userId: M1.id, reason: 'Back to the original manager' })).statusCode).toBe(200);
    const t = (await call(sP, 'GET', '/audit-trail?kind=changes&limit=100')).json().events as { sentence: string }[];
    const text = t.map((e) => e.sentence).join('\n');
    expect(text).toMatch(/changed the account manager of Reassign Ltd from .+ to .+\. Reason given: "Daniel is moving to the Savannah audit"/);
    expect(text).toMatch(/Reason given: "Back to the original manager"/);
  });

  test('a client that does not exist (or cannot be seen) gives 404', async () => {
    expect((await call(sP, 'POST', '/clients/00000000-0000-4000-8000-000000000000/account-manager', { userId: M2.id, reason: 'Does not exist' })).statusCode).toBe(404);
  });
});

describe('a person who still has responsibilities cannot be switched off', () => {
  let M3: TestUser;
  let sM3: Session;
  let c1: string;

  beforeAll(async () => {
    M3 = await makeUser(h, T.id, 'manager', 3);
    sM3 = await login(h, M3);
    c1 = (await call(sM3, 'POST', '/clients', clientBody('Leaver Traders'))).json().id;
    await call(sM3, 'POST', '/clients', clientBody('Leaver Farms'));
    await call(sS1, 'POST', '/prospects', { name: 'Leaver Prospect', sector: 'trading' });
  });

  test('the handover list shows what they hold', async () => {
    const r = await call(sA, 'GET', `/admin/users/${M3.id}/handover`);
    expect(r.statusCode).toBe(200);
    expect((r.json().clients as { name: string }[]).map((c) => c.name).sort()).toEqual(['Leaver Farms', 'Leaver Traders']);
    expect(r.json().prospects).toEqual([]);
    const staff = await call(sA, 'GET', `/admin/users/${S1.id}/handover`);
    expect((staff.json().prospects as { name: string }[]).map((p) => p.name)).toEqual(['Leaver Prospect']);
    expect((await call(sS1, 'GET', `/admin/users/${M3.id}/handover`)).statusCode).toBe(403);
  });

  test('switching them off, or moving them to a role that cannot manage, is refused', async () => {
    const off = await call(sA, 'PATCH', `/admin/users/${M3.id}`, { active: false });
    expect(off.statusCode).toBe(409);
    expect(off.json().error).toBe('has_responsibilities');
    expect((await call(sA, 'PATCH', `/admin/users/${M3.id}`, { role: 'staff' })).statusCode).toBe(409);
    expect((await call(sA, 'PATCH', `/admin/users/${S1.id}`, { active: false })).statusCode).toBe(409);
  });

  test('handing everything over moves the clients, the sessions of the new owner see them, and then switching off works', async () => {
    expect((await call(sA, 'POST', `/admin/users/${M3.id}/handover`, { toUserId: M2.id })).statusCode).toBe(400);
    const r = await call(sA, 'POST', `/admin/users/${M3.id}/handover`, { toUserId: M2.id, reason: 'Leaving the firm at month end' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ clients: 2, prospects: 0 });
    const after = await names(sM2);
    expect(after).toEqual(expect.arrayContaining(['Leaver Farms', 'Leaver Traders']));
    expect(await names(sM3)).not.toContain('Leaver Traders');
    expect((await call(sA, 'PATCH', `/admin/users/${M3.id}`, { active: false })).statusCode).toBe(200);
    expect(c1).toBeTruthy();
  });

  test('prospects are handed over to a colleague who can own them; a closed prospect does not block', async () => {
    expect((await call(sA, 'POST', `/admin/users/${S1.id}/handover`, { toUserId: A.id, reason: 'Admin cannot own one' })).statusCode).toBe(422);
    const r = await call(sA, 'POST', `/admin/users/${S1.id}/handover`, { toUserId: S2.id, reason: 'Brian is leaving' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ clients: 0, prospects: 1 });
    expect(((await call(sS2, 'GET', '/prospects')).json().prospects as { name: string }[]).map((p) => p.name)).toContain('Leaver Prospect');
    expect((await call(sA, 'PATCH', `/admin/users/${S1.id}`, { active: false })).statusCode).toBe(200);
  });

  test('the handover is in the audit trail as one plain sentence', async () => {
    const t = (await call(sP, 'GET', '/audit-trail?kind=changes&limit=200')).json().events as { sentence: string }[];
    expect(t.map((e) => e.sentence).join('\n')).toMatch(/handed over 2 clients and 0 prospects from .+ to .+\. Reason given: "Leaving the firm at month end"/);
  });
});
