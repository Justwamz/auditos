import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createSuperuserPool } from '@auditos/db';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, stepUp, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, M: TestUser, F: TestUser;
let sP: Session, sM: Session, sF: Session;
let client: string;

const call = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

const newEngagement = async (): Promise<string> => {
  const e = await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id });
  const id = e.json().id as string;
  await call(sM, 'POST', `/engagements/${id}/members`, { userId: F.id });
  return id;
};

const newPaper = async (e: string) => {
  const it = (await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'workpaper', title: 'Stock count', content: { notes: 'first draft', count: 10 } })).json();
  return it.id as string;
};

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'versions');
  P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sM = await login(h, M);
  sF = await login(h, F);
  for (const s of [sP, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  client = (await call(sM, 'POST', '/clients', { name: 'Trader Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
});
afterAll(async () => h.close());

describe('version history', () => {
  test('lists every version newest first with the editor and reason', async () => {
    const e = await newEngagement();
    const id = await newPaper(e);
    await call(sF, 'PATCH', `/items/${id}`, { content: { notes: 'second draft', count: 12 } });
    const r = await call(sF, 'GET', `/items/${id}/versions`);
    expect(r.statusCode).toBe(200);
    const v = r.json().versions as { version: number; editedByName: string | null; contentHash: string }[];
    expect(v.map((x) => x.version)).toEqual([2, 1]);
    expect(v[0]!.contentHash).toHaveLength(64);
    expect(r.json().versions[0].editedBy).toBe(F.id);
  });

  test('changes for a version show what moved from the one before', async () => {
    const e = await newEngagement();
    const id = await newPaper(e);
    await call(sF, 'PATCH', `/items/${id}`, { content: { notes: 'second draft', count: 10 } });
    const r = await call(sF, 'GET', `/items/${id}/versions/2/changes`);
    expect(r.json().changes).toEqual([{ path: 'notes', before: 'first draft', after: 'second draft' }]);
    const first = await call(sF, 'GET', `/items/${id}/versions/1/changes`);
    expect(first.json().changes.map((c: { path: string }) => c.path)).toEqual(['count', 'notes']);
    expect((await call(sF, 'GET', `/items/${id}/versions/9/changes`)).statusCode).toBe(404);
  });

  test('restoring an old version makes a new version, keeps the old ones, and revokes sign-offs', async () => {
    const e = await newEngagement();
    const id = await newPaper(e);
    await call(sF, 'PATCH', `/items/${id}`, { content: { notes: 'second draft', count: 12 } });
    const hash = (await call(sF, 'GET', `/items/${id}`)).json().contentHash;
    await stepUp(h, sF, F);
    expect((await call(sF, 'POST', `/items/${id}/signoff`, { level: 'prepared', expectedHash: hash })).statusCode).toBe(200);
    await stepUp(h, sM, M);
    expect((await call(sM, 'POST', `/items/${id}/signoff`, { level: 'manager', expectedHash: hash })).statusCode).toBe(200);
    const r = await call(sF, 'POST', `/items/${id}/restore`, { version: 1, reason: 'Second draft was wrong' });
    expect(r.statusCode).toBe(200);
    expect(r.json().version).toBe(3);
    const now = (await call(sF, 'GET', `/items/${id}`)).json();
    expect(now.content).toEqual({ notes: 'first draft', count: 10 });
    expect(now.signoffs.find((s: { level: string }) => s.level === 'manager').revoked).toBe(true);
    expect((await call(sF, 'GET', `/items/${id}/versions`)).json().versions).toHaveLength(3);
    expect((await call(sF, 'POST', `/items/${id}/restore`, { version: 1 })).statusCode).toBe(400);
    expect((await call(sF, 'POST', `/items/${id}/restore`, { version: 99, reason: 'does not exist' })).statusCode).toBe(404);
  });

  test('a person not on the engagement cannot see the versions', async () => {
    const e = await newEngagement();
    const id = await newPaper(e);
    const outsider = await login(h, await makeUser(h, T.id, 'staff', 1));
    expect((await call(outsider, 'GET', `/items/${id}/versions`)).statusCode).toBe(404);
  });
});

describe('versions are immutable, even against a superuser', () => {
  test('update, delete and truncate are refused by the database itself', async () => {
    const e = await newEngagement();
    const id = await newPaper(e);
    const su = createSuperuserPool(process.env, process.env.DB_NAME ?? 'auditos');
    try {
      await expect(su.query('update wp_item_versions set title = $2 where item_id = $1', [id, 'tampered'])).rejects.toThrow(/version_immutable/);
      await expect(su.query('delete from wp_item_versions where item_id = $1', [id])).rejects.toThrow(/version_immutable/);
      await expect(su.query('truncate wp_item_versions')).rejects.toThrow(/version_immutable/);
    } finally {
      await su.end();
    }
    expect((await call(sF, 'GET', `/items/${id}/versions`)).json().versions[0].title).toBe('Stock count');
  });
});
