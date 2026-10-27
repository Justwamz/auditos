import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, stepUp, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, NP: TestUser, M: TestUser, F: TestUser, OM: TestUser, OS: TestUser;
let sP: Session, sNP: Session, sM: Session, sF: Session, sOM: Session, sOS: Session;
let eng: string;
let paper: string;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'partnerview');
  P = await makeUser(h, T.id, 'partner', 4);
  NP = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  OM = await makeUser(h, T.id, 'manager', 3);
  OS = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sNP = await login(h, NP);
  sM = await login(h, M);
  sF = await login(h, F);
  sOM = await login(h, OM);
  sOS = await login(h, OS);
  for (const s of [sP, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  const client = (await call(sM, 'POST', '/clients', { name: 'Trader Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  eng = (await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${eng}/members`, { userId: F.id });
  paper = (await call(sF, 'POST', `/engagements/${eng}/items`, { kind: 'workpaper', title: 'Stock count', content: { notes: 'draft' } })).json().id;
});
afterAll(async () => h.close());

describe('a partner can view every engagement', () => {
  test('the engagement list includes engagements the partner is not on, flagged as view only', async () => {
    const list = (await call(sNP, 'GET', '/engagements')).json().engagements as { id: string; member: boolean }[];
    expect(list.find((e) => e.id === eng)).toMatchObject({ member: false });
    const mine = (await call(sP, 'GET', '/engagements')).json().engagements as { id: string; member: boolean }[];
    expect(mine.find((e) => e.id === eng)).toMatchObject({ member: true });
  });

  test('the file reads normally: engagement, papers, versions, notes, team, roadmap and completeness', async () => {
    const get = async (url: string) => (await call(sNP, 'GET', url)).statusCode;
    expect(await get(`/engagements/${eng}`)).toBe(200);
    expect((await call(sNP, 'GET', `/engagements/${eng}`)).json().member).toBe(false);
    expect(await get(`/engagements/${eng}/items`)).toBe(200);
    expect(await get(`/items/${paper}`)).toBe(200);
    expect(await get(`/items/${paper}/versions`)).toBe(200);
    expect(await get(`/items/${paper}/review-notes`)).toBe(200);
    expect(await get(`/engagements/${eng}/members`)).toBe(200);
    expect(await get(`/engagements/${eng}/roadmap`)).toBe(200);
    expect(await get(`/engagements/${eng}/completeness`)).toBe(200);
  });

  test('looking is recorded in the audit trail', async () => {
    const t = (await call(sP, 'GET', '/audit-trail?kind=views')).json().events as { sentence: string }[];
    expect(t.some((e) => /viewed the working paper "Stock count"/.test(e.sentence))).toBe(true);
  });

  test('other roles are unchanged: a manager or staff member who is not on the engagement still cannot see it', async () => {
    for (const s of [sOM, sOS]) {
      expect((await call(s, 'GET', `/engagements/${eng}`)).statusCode).toBe(404);
      expect((await call(s, 'GET', `/items/${paper}`)).statusCode).toBe(404);
      const list = (await call(s, 'GET', '/engagements')).json().engagements as { id: string }[];
      expect(list.map((e) => e.id)).not.toContain(eng);
    }
  });
});

describe('but a partner who is not on the team cannot change anything', () => {
  const denied = (status: number) => [403, 404, 409].includes(status);

  test('every kind of write is refused, never a server error, and nothing changes', async () => {
    await stepUp(h, sNP, NP);
    const before = (await call(sF, 'GET', `/items/${paper}`)).json();
    const attempts: [Method, string, object | undefined][] = [
      ['PATCH', `/items/${paper}`, { content: { notes: 'tampered' } }],
      ['POST', `/engagements/${eng}/items`, { kind: 'workpaper', title: 'Sneaky', content: {} }],
      ['POST', `/items/${paper}/signoff`, { level: 'partner', expectedHash: before.contentHash }],
      ['POST', `/items/${paper}/delete-request`, { reason: 'Not needed any more' }],
      ['POST', `/items/${paper}/review-notes`, { text: 'Please explain the count' }],
      ['POST', `/items/${paper}/restore`, { version: 1, reason: 'Going back to it' }],
      ['POST', `/engagements/${eng}/checklists/generate`, undefined],
      ['PUT', `/engagements/${eng}/materiality`, { benchmark: 'revenue', amount: '1000', percent: 1, rationale: 'Revenue is stable' }],
      ['POST', `/engagements/${eng}/members`, { userId: OS.id }],
      ['POST', `/engagements/${eng}/transition`, { to: 'planning' }],
      ['PUT', `/engagements/${eng}/mapping`, { mapping: { '1000': 'cash' } }],
      ['POST', `/engagements/${eng}/unlock-requests`, { reason: 'Need to reopen the file' }],
    ];
    for (const [method, url, body] of attempts) {
      const res = await call(sNP, method, url, body);
      expect(denied(res.statusCode), `${method} ${url} gave ${res.statusCode} ${res.body}`).toBe(true);
    }
    const after = (await call(sF, 'GET', `/items/${paper}`)).json();
    expect(after.version).toBe(before.version);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.signoffs).toEqual(before.signoffs);
    const items = (await call(sF, 'GET', `/engagements/${eng}/items`)).json().items as { title: string }[];
    expect(items.map((i) => i.title)).not.toContain('Sneaky');
    expect((await call(sF, 'GET', `/items/${paper}/review-notes`)).json().notes).toHaveLength(0);
  });

  test('a partner who is on the team can still work as before', async () => {
    const r = await call(sP, 'PATCH', `/items/${paper}`, { content: { notes: 'partner edit' } });
    expect(r.statusCode).toBe(200);
  });
});
