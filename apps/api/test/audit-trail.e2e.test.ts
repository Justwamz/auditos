import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { verifyChain } from '@auditos/audit-log';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, A: TestUser, M1: TestUser, M2: TestUser, F1: TestUser, F2: TestUser;
let sP: Session, sA: Session, sM1: Session, sM2: Session, sF1: Session, sF2: Session;
let clientA: string;
let clientB: string;
let engA: string;
let engB: string;
let paperA: string;
let paperB: string;

const call = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const trail = async (s: Session, qs = '') => (await call(s, 'GET', `/audit-trail${qs}`)).json() as {
  events: { seq: number; sentence: string; action: string; actorName: string; clientName: string | null }[];
  next: number | null;
};
const viewEvents = async (action: string, entityId: string) =>
  (await ownerQuery(h, T.id, 'select seq from audit_events where action = $1 and entity_id = $2', [action, entityId])).rows;

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'audittrail');
  P = await makeUser(h, T.id, 'partner', 4);
  A = await makeUser(h, T.id, 'firm_admin', 0);
  M1 = await makeUser(h, T.id, 'manager', 3);
  M2 = await makeUser(h, T.id, 'manager', 3);
  F1 = await makeUser(h, T.id, 'staff', 1);
  F2 = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sA = await login(h, A);
  sM1 = await login(h, M1);
  sM2 = await login(h, M2);
  sF1 = await login(h, F1);
  sF2 = await login(h, F2);
  for (const s of [sP, sM1, sM2, sF1, sF2]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  clientA = (await call(sM1, 'POST', '/clients', { name: 'Alpha Traders Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  clientB = (await call(sM2, 'POST', '/clients', { name: 'Beta Rentals Ltd', sector: 'rental', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  engA = (await call(sM1, 'POST', '/engagements', { clientId: clientA, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  engB = (await call(sM2, 'POST', '/engagements', { clientId: clientB, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM1, 'POST', `/engagements/${engA}/members`, { userId: F1.id });
  await call(sM2, 'POST', `/engagements/${engB}/members`, { userId: F2.id });
  paperA = (await call(sF1, 'POST', `/engagements/${engA}/items`, { kind: 'workpaper', title: 'Stock count', content: { notes: 'x' } })).json().id;
  paperB = (await call(sF2, 'POST', `/engagements/${engB}/items`, { kind: 'workpaper', title: 'Rent roll', content: { notes: 'y' } })).json().id;
});
afterAll(async () => h.close());

describe('views are recorded, once per five minutes', () => {
  test('opening a paper twice logs one view', async () => {
    await call(sF1, 'GET', `/items/${paperA}`);
    await call(sF1, 'GET', `/items/${paperA}`);
    expect(await viewEvents('view.paper', paperA)).toHaveLength(1);
  });

  test('a different person viewing the same paper is logged separately', async () => {
    await call(sM1, 'GET', `/items/${paperA}`);
    expect(await viewEvents('view.paper', paperA)).toHaveLength(2);
  });

  test('opening an engagement and a client are logged', async () => {
    await call(sM1, 'GET', `/engagements/${engA}`);
    await call(sP, 'GET', `/clients/${clientA}`);
    expect(await viewEvents('view.engagement', engA)).toHaveLength(1);
    expect(await viewEvents('view.client', clientA)).toHaveLength(1);
  });

  test('a view that is refused is not logged', async () => {
    await call(sF2, 'GET', `/items/${paperA}`);
    expect((await viewEvents('view.paper', paperA)).length).toBe(2);
  });
});

describe('the trail reads as plain English', () => {
  test('a partner sees sentences with names, the paper and the client', async () => {
    const t = await trail(sP);
    const sentences = t.events.map((e) => e.sentence);
    expect(sentences.some((s) => /viewed the working paper "Stock count" for Alpha Traders Ltd$/.test(s))).toBe(true);
    expect(sentences.some((s) => /^Tester u-staff-?\S* created the working paper "Stock count" for Alpha Traders Ltd$|created the working paper "Stock count" for Alpha Traders Ltd/.test(s))).toBe(true);
    expect(sentences.some((s) => /viewed the client file of Alpha Traders Ltd$/.test(s))).toBe(true);
    expect(t.events.every((e, i, all) => i === 0 || all[i - 1]!.seq > e.seq)).toBe(true);
  });

  test('the admin permission sees the whole firm; a plain partner role is not needed', async () => {
    expect((await trail(sA)).events.length).toBeGreaterThan(5);
  });

  test('a manager sees only engagements they are on', async () => {
    const t = await trail(sM1);
    const text = t.events.map((e) => e.sentence).join('\n');
    expect(text).toContain('Alpha Traders Ltd');
    expect(text).not.toContain('Beta Rentals Ltd');
    expect(text).not.toContain('Rent roll');
  });

  test('staff cannot open the trail', async () => {
    expect((await call(sF1, 'GET', '/audit-trail')).statusCode).toBe(403);
  });

  test('filters: by kind, by client, by person and by date', async () => {
    const views = await trail(sP, '?kind=views');
    expect(views.events.length).toBeGreaterThan(0);
    expect(views.events.every((e) => /^(view|evidence|export)\./.test(e.action))).toBe(true);

    const onlyB = await trail(sP, `?client=${clientB}`);
    expect(onlyB.events.length).toBeGreaterThan(0);
    expect(onlyB.events.every((e) => e.clientName === 'Beta Rentals Ltd')).toBe(true);

    const byUser = await trail(sP, `?user=${F1.id}`);
    expect(byUser.events.length).toBeGreaterThan(0);
    expect(byUser.events.every((e) => e.sentence.length > 0)).toBe(true);

    expect((await trail(sP, '?from=2999-01-01')).events).toEqual([]);
    expect((await call(sP, 'GET', '/audit-trail?kind=bogus')).statusCode).toBe(400);
  });

  test('paging walks back through older events without repeats', async () => {
    const first = await trail(sP, '?limit=3');
    expect(first.events).toHaveLength(3);
    expect(first.next).not.toBeNull();
    const second = await trail(sP, `?limit=3&before=${first.next}`);
    const seqs = [...first.events, ...second.events].map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe('integrity', () => {
  test('the hash chain still verifies with views in it', async () => {
    expect(await verifyChain(h.owner, T.id)).toEqual({ ok: true });
  });

  test('the application cannot write other action families', async () => {
    await expect(
      ownerQuery(h, T.id, "select audit_append('item.edited', 'wp_item', null, '{}'::jsonb)", [], P.id),
    ).rejects.toThrow(/not allowed/i);
    await expect(ownerQuery(h, T.id, "select audit_append('view.paper', 'wp_item', null, '{}'::jsonb)", [], P.id)).resolves.toBeDefined();
  });

  test('every view of a paper in engagement B stays out of engagement A manager trail', async () => {
    await call(sF2, 'GET', `/items/${paperB}`);
    const t = await trail(sM1);
    expect(t.events.map((e) => e.sentence).join('\n')).not.toContain('Rent roll');
  });
});
