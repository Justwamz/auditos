import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, M: TestUser, F: TestUser, OUT: TestUser;
let sP: Session, sM: Session, sF: Session, sOut: Session;
let engId: string;

const call = (s: Session, method: 'GET' | 'POST', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'people');
  P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  OUT = await makeUser(h, T.id, 'senior', 2);
  sP = await login(h, P);
  sM = await login(h, M);
  sF = await login(h, F);
  sOut = await login(h, OUT);
  for (const s of [sP, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  const c = (await call(sM, 'POST', '/clients', { name: 'People Client', sector: 'trading', legalForm: 'sole', yearEndMonth: 12 })).json().id;
  engId = (await call(sM, 'POST', '/engagements', { clientId: c, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${engId}/members`, { userId: F.id });
});
afterAll(async () => h.close());

describe('people and team', () => {
  test('any member can list active people in their own firm, without secrets', async () => {
    const people = (await call(sF, 'GET', '/people')).json().people as { id: string; email: string; role: string }[];
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining([P.id, M.id, F.id, OUT.id]));
    expect(Object.keys(people[0]!).sort()).toEqual(['email', 'grade', 'id', 'role']);
    const other = await makeTenant(h, 'people-other');
    expect(people.map((p) => p.id)).not.toContain(other.adminId);
  });

  test('the team of an engagement is visible to its members only', async () => {
    const team = (await call(sF, 'GET', `/engagements/${engId}/members`)).json().members as { userId: string; role: string; email: string }[];
    expect(team.map((t) => t.userId).sort()).toEqual([F.id, M.id, P.id].sort());
    expect(team.find((t) => t.userId === P.id)?.role).toBe('partner');
    expect((await call(sOut, 'GET', `/engagements/${engId}/members`)).statusCode).toBe(404);
  });

  test('a user sees only their own independence declarations', async () => {
    const mine = (await call(sF, 'GET', '/independence')).json().declarations as { userId?: string; expiresAt: string }[];
    expect(mine).toHaveLength(1);
    expect(new Date(mine[0]!.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await call(sOut, 'GET', '/independence')).json().declarations).toEqual([]);
  });
});
