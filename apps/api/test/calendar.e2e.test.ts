import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, A: TestUser, M: TestUser, M2: TestUser, F: TestUser, S: TestUser;
let sP: Session, sA: Session, sM: Session, sM2: Session, sF: Session, sS: Session;
let eng: string;

type Method = 'GET' | 'POST' | 'PATCH';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const RANGE = 'from=2026-11-01&to=2026-11-30';
const titles = async (s: Session, extra = '') => {
  const r = await call(s, 'GET', `/calendar?${RANGE}${extra}`);
  return (r.json().events as { title: string }[]).map((e) => e.title).sort();
};
const event = (over: object = {}) => ({
  title: 'Planning meeting', kind: 'meeting', startsAt: '2026-11-10T07:00:00.000Z', endsAt: '2026-11-10T08:00:00.000Z', ...over,
});

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'calendar');
  P = await makeUser(h, T.id, 'partner', 4);
  A = await makeUser(h, T.id, 'firm_admin', 0);
  M = await makeUser(h, T.id, 'manager', 3);
  M2 = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  S = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sA = await login(h, A);
  sM = await login(h, M);
  sM2 = await login(h, M2);
  sF = await login(h, F);
  sS = await login(h, S);
  for (const s of [sP, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  const client = (await call(sM, 'POST', '/clients', { name: 'Calendar Traders', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  eng = (await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-11-30', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${eng}/members`, { userId: F.id });
});
afterAll(async () => h.close());

describe('who sees an event', () => {
  test('the person who made it and the people invited see it; people it does not concern do not', async () => {
    const r = await call(sF, 'POST', '/calendar', event({ title: 'Pre-planning with Daniel', attendeeIds: [M.id] }));
    expect(r.statusCode).toBe(201);
    expect(await titles(sF)).toContain('Pre-planning with Daniel');
    expect(await titles(sM)).toContain('Pre-planning with Daniel');
    expect(await titles(sS)).not.toContain('Pre-planning with Daniel');
    expect(await titles(sM2)).not.toContain('Pre-planning with Daniel');
    expect(await titles(sA)).not.toContain('Pre-planning with Daniel');
  });

  test('a partner sees every event in the firm', async () => {
    expect(await titles(sP)).toContain('Pre-planning with Daniel');
  });

  test('a manager also sees what the people on their engagement teams are doing, even if not invited', async () => {
    await call(sF, 'POST', '/calendar', event({ title: 'Fieldwork at the client', kind: 'fieldwork' }));
    expect(await titles(sM)).toContain('Fieldwork at the client');
    expect(await titles(sM2)).not.toContain('Fieldwork at the client');
    expect(await titles(sS)).not.toContain('Fieldwork at the client');
  });

  test('an event on an engagement is seen by its team', async () => {
    const r = await call(sM, 'POST', '/calendar', event({ title: 'Team stand-up', engagementId: eng }));
    expect(r.statusCode).toBe(201);
    expect(await titles(sF)).toContain('Team stand-up');
    expect(await titles(sS)).not.toContain('Team stand-up');
  });

  test('filtering by person shows what that person is doing', async () => {
    expect(await titles(sP, `&person=${F.id}`)).toEqual(['Fieldwork at the client', 'Pre-planning with Daniel']);
    expect(await titles(sP, `&person=${S.id}`)).toEqual([]);
  });
});

describe('creating and changing events', () => {
  test('bad input is refused', async () => {
    expect((await call(sF, 'POST', '/calendar', event({ title: 'x' }))).statusCode).toBe(400);
    expect((await call(sF, 'POST', '/calendar', event({ kind: 'party' }))).statusCode).toBe(400);
    expect((await call(sF, 'POST', '/calendar', event({ startsAt: '2026-11-10T09:00:00.000Z', endsAt: '2026-11-10T08:00:00.000Z' }))).statusCode).toBe(400);
    expect((await call(sF, 'POST', '/calendar', event({ startsAt: 'tomorrow' }))).statusCode).toBe(400);
    expect((await call(sF, 'POST', '/calendar', event({ attendeeIds: [A.id] }))).statusCode).toBe(422);
    expect((await call(sF, 'POST', '/calendar', event({ attendeeIds: ['00000000-0000-4000-8000-000000000000'] }))).statusCode).toBe(422);
  });

  test('an engagement you are not on cannot be used, and a firm administrator cannot schedule', async () => {
    expect((await call(sS, 'POST', '/calendar', event({ engagementId: eng }))).statusCode).toBe(404);
    expect((await call(sA, 'POST', '/calendar', event())).statusCode).toBe(403);
  });

  test('only the person who made an event can change it', async () => {
    const id = (await call(sF, 'POST', '/calendar', event({ title: 'Original title', attendeeIds: [M.id] }))).json().id as string;
    expect((await call(sF, 'PATCH', `/calendar/${id}`, event({ title: 'Edited title', attendeeIds: [M.id] }))).statusCode).toBe(200);
    expect(await titles(sM)).toContain('Edited title');
    expect((await call(sM, 'PATCH', `/calendar/${id}`, event({ title: 'Hijacked' }))).statusCode).toBe(403);
    expect((await call(sS, 'PATCH', `/calendar/${id}`, event({ title: 'Hijacked' }))).statusCode).toBe(404);
  });

  test('cancelling removes it from the calendar; the maker or a partner may cancel; it cannot be cancelled twice', async () => {
    const id = (await call(sF, 'POST', '/calendar', event({ title: 'To be cancelled' }))).json().id as string;
    expect((await call(sM, 'POST', `/calendar/${id}/cancel`)).statusCode).toBe(403);
    expect((await call(sP, 'POST', `/calendar/${id}/cancel`)).statusCode).toBe(200);
    expect(await titles(sF)).not.toContain('To be cancelled');
    expect((await call(sF, 'POST', `/calendar/${id}/cancel`)).statusCode).toBe(409);
    expect((await call(sF, 'PATCH', `/calendar/${id}`, event({ title: 'Back again' }))).statusCode).toBe(409);
  });
});

describe('dates and ranges', () => {
  test('events outside the range are not returned, and the range is limited', async () => {
    await call(sF, 'POST', '/calendar', event({ title: 'December event', startsAt: '2026-12-15T07:00:00.000Z', endsAt: '2026-12-15T08:00:00.000Z' }));
    expect(await titles(sF)).not.toContain('December event');
    const dec = await call(sF, 'GET', '/calendar?from=2026-12-01&to=2026-12-31');
    expect((dec.json().events as { title: string }[]).map((e) => e.title)).toContain('December event');
    expect((await call(sF, 'GET', '/calendar?from=2026-01-01&to=2026-12-31')).statusCode).toBe(400);
    expect((await call(sF, 'GET', '/calendar?from=2026-12-31&to=2026-12-01')).statusCode).toBe(400);
    expect((await call(sF, 'GET', '/calendar')).statusCode).toBe(400);
  });

  test('engagement milestones appear by themselves for the team and for partners, not for outsiders', async () => {
    const ms = async (s: Session) => ((await call(s, 'GET', `/calendar?${RANGE}`)).json().milestones as { title: string; date: string }[]).map((m) => `${m.date} ${m.title}`);
    expect(await ms(sF)).toContain('2026-11-30 Year end: Calendar Traders');
    expect(await ms(sP)).toContain('2026-11-30 Year end: Calendar Traders');
    expect(await ms(sS)).not.toContain('2026-11-30 Year end: Calendar Traders');
    expect(await ms(sM2)).toEqual([]);
  });
});

describe('every change is in the audit trail', () => {
  test('scheduling, changing and cancelling read as sentences', async () => {
    const t = (await call(sP, 'GET', '/audit-trail?kind=changes&limit=200')).json().events as { sentence: string }[];
    const text = t.map((e) => e.sentence).join('\n');
    expect(text).toMatch(/scheduled the meeting "Pre-planning with Daniel"/);
    expect(text).toMatch(/scheduled the meeting "Team stand-up" for Calendar Traders/);
    expect(text).toMatch(/changed the meeting "Edited title"/);
    expect(text).toMatch(/cancelled the meeting "To be cancelled"/);
  });
});
