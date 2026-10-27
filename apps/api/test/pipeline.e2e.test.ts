import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, M: TestUser, S1: TestUser, S2: TestUser, A: TestUser;
let sP: Session, sM: Session, sS1: Session, sS2: Session, sA: Session;

type Method = 'GET' | 'POST' | 'PATCH';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const list = async (s: Session) => (await call(s, 'GET', '/prospects')).json() as {
  prospects: { id: string; name: string; stage: string; ownerId: string; ownerName: string; expectedFee: string | null; clientId: string | null }[];
  summary: { byStage: Record<string, { count: number; value: string }>; byOwner: { ownerId: string; count: number; value: string }[] };
};
const names = async (s: Session) => (await list(s)).prospects.map((p) => p.name).sort();
const create = async (s: Session, body: object) => call(s, 'POST', '/prospects', { name: 'Acme Traders Ltd', sector: 'trading', ...body });

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'pipeline');
  P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  S1 = await makeUser(h, T.id, 'staff', 1);
  S2 = await makeUser(h, T.id, 'staff', 1);
  A = await makeUser(h, T.id, 'firm_admin', 0);
  sP = await login(h, P);
  sM = await login(h, M);
  sS1 = await login(h, S1);
  sS2 = await login(h, S2);
  sA = await login(h, A);
});
afterAll(async () => h.close());

describe('who sees which prospect', () => {
  test('a staff member owns what they add; others on staff do not see it; partners and managers see everything', async () => {
    const r = await create(sS1, { name: 'Baraka Hauliers' });
    expect(r.statusCode).toBe(201);
    await create(sS2, { name: 'Zawadi Clinic' });
    expect(await names(sS1)).toEqual(['Baraka Hauliers']);
    expect(await names(sS2)).toEqual(['Zawadi Clinic']);
    expect(await names(sM)).toEqual(['Baraka Hauliers', 'Zawadi Clinic']);
    expect(await names(sP)).toEqual(['Baraka Hauliers', 'Zawadi Clinic']);
  });

  test('a prospect that is not yours is not found (404), not forbidden', async () => {
    const id = (await list(sS1)).prospects[0]!.id;
    expect((await call(sS2, 'POST', `/prospects/${id}/stage`, { stage: 'proposal' })).statusCode).toBe(404);
    expect((await call(sS2, 'PATCH', `/prospects/${id}`, { name: 'Hijacked Ltd' })).statusCode).toBe(404);
  });

  test('the firm administrator has no access to the pipeline', async () => {
    expect((await call(sA, 'GET', '/prospects')).statusCode).toBe(403);
    expect((await create(sA, { name: 'Admin Prospect' })).statusCode).toBe(403);
  });

  test('staff may only own what they add; a manager can add one for a colleague', async () => {
    expect((await create(sS1, { name: 'For Someone Else', ownerId: S2.id })).statusCode).toBe(403);
    const r = await create(sM, { name: 'Delegated Co', ownerId: S2.id });
    expect(r.statusCode).toBe(201);
    expect(await names(sS2)).toContain('Delegated Co');
    expect((await create(sM, { name: 'Bad Owner', ownerId: A.id })).statusCode).toBe(422);
  });
});

describe('moving a prospect along', () => {
  let id: string;
  beforeAll(async () => {
    id = (await create(sS1, { name: 'Moving Ltd', expectedFee: '450000.00', expectedStart: '2027-02-01' })).json().id;
  });

  test('forward and back between the open stages', async () => {
    for (const stage of ['proposal', 'loe_sent', 'lead']) expect((await call(sS1, 'POST', `/prospects/${id}/stage`, { stage })).statusCode).toBe(200);
  });

  test('winning is only possible by converting to a client; lost needs a reason', async () => {
    expect((await call(sS1, 'POST', `/prospects/${id}/stage`, { stage: 'won' })).statusCode).toBe(422);
    expect((await call(sS1, 'POST', `/prospects/${id}/stage`, { stage: 'lost' })).statusCode).toBe(422);
    expect((await call(sS1, 'POST', `/prospects/${id}/stage`, { stage: 'nonsense' })).statusCode).toBe(400);
  });

  test('a lost prospect is closed: no more changes', async () => {
    const lost = (await create(sS1, { name: 'Lost Ltd' })).json().id;
    expect((await call(sS1, 'POST', `/prospects/${lost}/stage`, { stage: 'lost', reason: 'Went with another firm on price' })).statusCode).toBe(200);
    expect((await call(sS1, 'POST', `/prospects/${lost}/stage`, { stage: 'lead' })).statusCode).toBe(409);
    expect((await call(sS1, 'PATCH', `/prospects/${lost}`, { name: 'Lost Ltd Again' })).statusCode).toBe(409);
  });

  test('details can be edited by the owner; fees are validated and returned as KES strings', async () => {
    const r = await call(sS1, 'PATCH', `/prospects/${id}`, { name: 'Moving Limited', expectedFee: '500000.50', notes: 'Met the director on Tuesday' });
    expect(r.statusCode).toBe(200);
    const p = (await list(sS1)).prospects.find((x) => x.id === id)!;
    expect(p).toMatchObject({ name: 'Moving Limited', expectedFee: '500000.50' });
    expect((await call(sS1, 'PATCH', `/prospects/${id}`, { expectedFee: '-5' })).statusCode).toBe(400);
    expect((await call(sS1, 'PATCH', `/prospects/${id}`, { expectedFee: 'lots' })).statusCode).toBe(400);
  });
});

describe('handing a prospect to someone else', () => {
  test('a manager can hand it over with a reason; the old owner loses sight of it and the new one gains it', async () => {
    const id = (await create(sS1, { name: 'Handover Ltd' })).json().id;
    expect((await call(sM, 'POST', `/prospects/${id}/owner`, { userId: S2.id })).statusCode).toBe(400);
    expect((await call(sM, 'POST', `/prospects/${id}/owner`, { userId: S2.id, reason: 'Lucy knows the family' })).statusCode).toBe(200);
    expect(await names(sS1)).not.toContain('Handover Ltd');
    expect(await names(sS2)).toContain('Handover Ltd');
  });

  test('staff cannot hand over, and the new owner must be able to own one', async () => {
    const id = (await create(sS1, { name: 'Stuck Ltd' })).json().id;
    expect((await call(sS1, 'POST', `/prospects/${id}/owner`, { userId: S2.id, reason: 'Passing it on' })).statusCode).toBe(403);
    expect((await call(sM, 'POST', `/prospects/${id}/owner`, { userId: A.id, reason: 'Wrong person entirely' })).statusCode).toBe(422);
  });
});

describe('converting a prospect into a client', () => {
  test('a manager converts it once: one client, the account manager they choose, the prospect marked won', async () => {
    const id = (await create(sS1, { name: 'Convert Ltd', sector: 'rental' })).json().id;
    const r = await call(sM, 'POST', `/prospects/${id}/convert`, { legalForm: 'Limited company', yearEndMonth: 12, accountManagerId: M.id });
    expect(r.statusCode).toBe(201);
    const clientId = r.json().clientId as string;
    const clients = (await call(sM, 'GET', '/clients')).json().clients as { id: string; name: string; sector: string; accountManagerId: string }[];
    expect(clients.find((c) => c.id === clientId)).toMatchObject({ name: 'Convert Ltd', sector: 'rental', accountManagerId: M.id });
    const p = (await list(sM)).prospects.find((x) => x.id === id)!;
    expect(p).toMatchObject({ stage: 'won', clientId });
    const again = await call(sM, 'POST', `/prospects/${id}/convert`, { legalForm: 'Limited company', yearEndMonth: 12, accountManagerId: M.id });
    expect(again.statusCode).toBe(409);
    expect(((await call(sM, 'GET', '/clients')).json().clients as { name: string }[]).filter((c) => c.name === 'Convert Ltd')).toHaveLength(1);
  });

  test('staff cannot convert, and the account manager must be a manager or partner', async () => {
    const id = (await create(sS1, { name: 'Nope Ltd' })).json().id;
    expect((await call(sS1, 'POST', `/prospects/${id}/convert`, { legalForm: 'Limited company', yearEndMonth: 12 })).statusCode).toBe(403);
    expect((await call(sM, 'POST', `/prospects/${id}/convert`, { legalForm: 'Limited company', yearEndMonth: 12, accountManagerId: S1.id })).statusCode).toBe(400);
    expect(((await list(sM)).prospects.find((x) => x.id === id)!).stage).toBe('lead');
  });
});

describe('the pipeline summary', () => {
  test('totals by stage and by owner, in KES', async () => {
    const t2 = await makeTenant(h, 'pipeline-summary');
    const mgr = await makeUser(h, t2.id, 'manager', 3);
    const st = await makeUser(h, t2.id, 'staff', 1);
    const sm = await login(h, mgr);
    const ss = await login(h, st);
    await create(ss, { name: 'One Ltd', expectedFee: '100000.00' });
    const two = (await create(ss, { name: 'Two Ltd', expectedFee: '250000.50' })).json().id;
    await create(sm, { name: 'Three Ltd', expectedFee: '50000.00' });
    await call(ss, 'POST', `/prospects/${two}/stage`, { stage: 'proposal' });
    const s = (await list(sm)).summary;
    expect(s.byStage.lead).toEqual({ count: 2, value: '150000.00' });
    expect(s.byStage.proposal).toEqual({ count: 1, value: '250000.50' });
    expect(s.byOwner.find((o) => o.ownerId === st.id)).toMatchObject({ count: 2, value: '350000.50' });
  });
});

describe('every change is in the audit trail in plain English', () => {
  test('creation, stage changes, hand-overs and conversion read as sentences', async () => {
    const t = (await call(sP, 'GET', '/audit-trail?kind=changes&limit=200')).json().events as { sentence: string }[];
    const text = t.map((e) => e.sentence).join('\n');
    expect(text).toMatch(/added the prospect Baraka Hauliers, owned by /);
    expect(text).toMatch(/moved the prospect Moving Ltd from lead to proposal/);
    expect(text).toMatch(/handed the prospect Handover Ltd from .+ to .+\. Reason given: "Lucy knows the family"/);
    expect(text).toMatch(/moved the prospect Lost Ltd from lead to lost. Reason given: "Went with another firm on price"/);
    expect(text).toMatch(/converted the prospect Convert Ltd into a client/);
  });
});
