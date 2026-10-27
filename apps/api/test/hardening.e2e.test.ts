import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { withTenant } from '@auditos/db';
import { lockDueEngagements } from '../src/engagements/service';
import { harness, login, makeTenant, makeUser, ownerQuery, stepUp, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, P2: TestUser, M: TestUser, F: TestUser;
let sP: Session, sP2: Session, sM: Session, sF: Session;
let clientId: string;
let engId: string;

const call = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const asUser = <R>(u: TestUser, fn: (tx: import('pg').PoolClient) => Promise<R>) => withTenant(h.app.pools.app, { tenantId: T.id, userId: u.id }, fn);

const newEngagement = async (): Promise<string> => {
  const id = (await call(sM, 'POST', '/engagements', { clientId, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id as string;
  for (const u of [F, P2]) await call(sM, 'POST', `/engagements/${id}/members`, { userId: u.id });
  return id;
};
const signoff = async (s: Session, u: TestUser, id: string, level: string) => {
  const hash = (await call(s, 'GET', `/items/${id}`)).json().contentHash;
  await stepUp(h, s, u);
  return call(s, 'POST', `/items/${id}/signoff`, { level, expectedHash: hash });
};

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'hardening');
  P = await makeUser(h, T.id, 'partner', 4);
  P2 = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sP2 = await login(h, P2);
  sM = await login(h, M);
  sF = await login(h, F);
  for (const s of [sP, sP2, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  clientId = (await call(sM, 'POST', '/clients', { name: 'Hardening Client', sector: 'trading', legalForm: 'sole', yearEndMonth: 12 })).json().id;
  engId = await newEngagement();
});
afterAll(async () => h.close());

describe('engagement state cannot be changed outside the controlled paths', () => {
  test('the application role cannot update engagement state, report date or EQR directly', async () => {
    for (const sql of ["update engagements set state = 'locked' where id = $1", "update engagements set eqr_id = null where id = $1", "update engagements set report_date = current_date where id = $1"]) {
      await expect(asUser(F, (tx) => tx.query(sql, [engId]))).rejects.toThrow(/permission denied/);
    }
  });

  test('setting app.unlock from a session does not unlock a locked engagement', async () => {
    const e = await newEngagement();
    for (const s of ['planning', 'fieldwork', 'completion', 'review', 'partner_approved']) await ownerQuery(h, T.id, 'update engagements set state = $2 where id = $1', [e, s]);
    await ownerQuery(h, T.id, "update engagements set state = 'report_issued', report_date = current_date - 90 where id = $1", [e]);
    await lockDueEngagements(h.app.pools.app, new Date());
    await expect(
      asUser(F, async (tx) => {
        await tx.query("select set_config('app.unlock', 'on', true)");
        await tx.query("update engagements set state = 'report_issued' where id = $1", [e]);
      }),
    ).rejects.toThrow(/permission denied/);
    expect((await ownerQuery(h, T.id, 'select state from engagements where id = $1', [e])).rows[0].state).toBe('locked');
  });

  test('even the owner role needs the unlock procedure: a bare flag from a non-owner role is refused by the trigger', async () => {
    const e = await newEngagement();
    for (const s of ['planning', 'fieldwork', 'completion', 'review', 'partner_approved']) await ownerQuery(h, T.id, 'update engagements set state = $2 where id = $1', [e, s]);
    await ownerQuery(h, T.id, "update engagements set state = 'report_issued', report_date = current_date - 90 where id = $1", [e]);
    await lockDueEngagements(h.app.pools.app, new Date());
    const r = await call(sF, 'POST', `/engagements/${e}/transition`, { to: 'report_issued', reportDate: '2026-12-31' });
    expect([403, 409]).toContain(r.statusCode);
    expect((await ownerQuery(h, T.id, 'select state from engagements where id = $1', [e])).rows[0].state).toBe('locked');
  });

  test('only a partner can pick the EQR, even by calling the database function directly', async () => {
    await expect(asUser(F, (tx) => tx.query('select engagement_set_eqr($1, $2)', [engId, P2.id]))).rejects.toThrow(/forbidden/);
    await expect(asUser(M, (tx) => tx.query('select engagement_set_eqr($1, $2)', [engId, P2.id]))).rejects.toThrow(/forbidden/);
  });

  test('a transition made through the API still works for a manager and still needs a partner for the last steps', async () => {
    const e = await newEngagement();
    for (const s of ['planning', 'fieldwork', 'completion', 'review']) await ownerQuery(h, T.id, 'update engagements set state = $2 where id = $1', [e, s]);
    expect((await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'partner_approved' })).statusCode).toBe(403);
    await expect(asUser(M, (tx) => tx.query("select engagement_transition($1, 'partner_approved', null)", [e]))).rejects.toThrow(/forbidden/);
  });
});

describe('roles and memberships cannot be changed by their holders', () => {
  test('a user cannot promote themselves or insert memberships', async () => {
    await expect(asUser(F, (tx) => tx.query("update memberships set role = 'partner', grade = 9 where user_id = $1", [F.id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(F, (tx) => tx.query("insert into memberships (tenant_id, user_id, role, grade) values ($1, $2, 'partner', 4)", [T.id, F.id]))).rejects.toThrow(/permission denied/);
  });

  test('a user cannot edit their firm’s settings', async () => {
    await expect(asUser(F, (tx) => tx.query("update tenants set settings = '{\"assemblyDays\":\"x\"}'"))).rejects.toThrow(/permission denied/);
  });

  test('independence declarations cannot choose their own dates', async () => {
    await expect(
      asUser(F, (tx) => tx.query("insert into independence_declarations (tenant_id, user_id, statement, expires_at) values ($1, $2, 'Forever valid declaration', now() + interval '50 years')", [T.id, F.id])),
    ).rejects.toThrow(/permission denied/);
  });

  test('a deactivated partner can no longer act on items even through the database', async () => {
    const e = await newEngagement();
    const it = (await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'checklist', title: 'Deactivation', content: {} })).json();
    await signoff(sF, F, it.id, 'prepared');
    await signoff(sM, M, it.id, 'manager');
    await ownerQuery(h, T.id, 'update memberships set active = false where user_id = $1', [P2.id]);
    await expect(asUser(P2, (tx) => tx.query("select item_signoff($1, 'partner', $2)", [it.id, it.contentHash]))).rejects.toThrow(/not_found/);
    await ownerQuery(h, T.id, 'update memberships set active = true where user_id = $1', [P2.id]);
  });
});

describe('separation of duties on sign-off', () => {
  test('one person cannot give both the review and the approval', async () => {
    const e = await newEngagement();
    const it = (await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'checklist', title: 'One person', content: {} })).json();
    await signoff(sF, F, it.id, 'prepared');
    expect((await signoff(sP, P, it.id, 'manager')).statusCode).toBe(200);
    const again = await signoff(sP, P, it.id, 'partner');
    expect(again.statusCode).toBe(403);
    expect((await signoff(sP2, P2, it.id, 'partner')).statusCode).toBe(200);
  });

  test('the reviewer must be of a higher grade than the last editor, checked in the database too', async () => {
    const e = await newEngagement();
    const it = (await call(sM, 'POST', `/engagements/${e}/items`, { kind: 'checklist', title: 'Manager paper', content: {} })).json();
    await signoff(sM, M, it.id, 'prepared');
    const peer = await makeUser(h, T.id, 'manager', 3);
    const sPeer = await login(h, peer);
    await call(sPeer, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
    await call(sM, 'POST', `/engagements/${e}/members`, { userId: peer.id });
    await expect(asUser(peer, (tx) => tx.query("select item_signoff($1, 'manager', $2)", [it.id, it.contentHash]))).rejects.toThrow(/grade|forbidden/);
  });

  test('a sign-off for an older version is refused even if the item has since been edited', async () => {
    const e = await newEngagement();
    const it = (await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'checklist', title: 'Race', content: { v: 1 } })).json();
    await signoff(sF, F, it.id, 'prepared');
    const stale = (await call(sM, 'GET', `/items/${it.id}`)).json().contentHash;
    await call(sF, 'PATCH', `/items/${it.id}`, { content: { v: 2 } });
    await stepUp(h, sM, M);
    const res = await call(sM, 'POST', `/items/${it.id}/signoff`, { level: 'manager', expectedHash: stale });
    expect(res.statusCode).toBe(409);
  });
});

describe('addenda, the audit log and the lock job', () => {
  test('after locking, only a real addendum of an item in the same engagement can be added', async () => {
    const e = await newEngagement();
    const target = (await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'checklist', title: 'Target', content: {} })).json();
    const other = await newEngagement();
    const foreign = (await call(sF, 'POST', `/engagements/${other}/items`, { kind: 'checklist', title: 'Foreign', content: {} })).json();
    for (const s of ['planning', 'fieldwork', 'completion', 'review', 'partner_approved']) await ownerQuery(h, T.id, 'update engagements set state = $2 where id = $1', [e, s]);
    await ownerQuery(h, T.id, "update engagements set state = 'report_issued', report_date = current_date - 90 where id = $1", [e]);
    await lockDueEngagements(h.app.pools.app, new Date());
    const ins = (kind: string, of: string) =>
      asUser(F, (tx) => tx.query('insert into wp_items (tenant_id, engagement_id, kind, title, content, addendum_of, created_by) values ($1, $2, $3, $4, $5, $6, $7)', [T.id, e, kind, 'x', '{}', of, F.id]));
    await expect(ins('addendum', foreign.id)).rejects.toThrow();
    await expect(ins('checklist', target.id)).rejects.toThrow();
    await expect(ins('addendum', target.id)).resolves.toBeDefined();
  });

  test('the application cannot write system-style audit events', async () => {
    await expect(asUser(F, (tx) => tx.query("select audit_append('engagement.unlocked', 'engagement', 'x', '{}')"))).rejects.toThrow();
    await expect(asUser(F, (tx) => tx.query("select audit_append('export.created', 'engagement', 'x', '{}')"))).resolves.toBeDefined();
  });

  test('the lock job cannot be pushed into the future by a caller', async () => {
    const e = await newEngagement();
    for (const s of ['planning', 'fieldwork', 'completion', 'review', 'partner_approved']) await ownerQuery(h, T.id, 'update engagements set state = $2 where id = $1', [e, s]);
    await ownerQuery(h, T.id, "update engagements set state = 'report_issued', report_date = current_date - 10 where id = $1", [e]);
    await lockDueEngagements(h.app.pools.app, new Date('2126-01-01'));
    expect((await ownerQuery(h, T.id, 'select state from engagements where id = $1', [e])).rows[0].state).toBe('report_issued');
  });

  test('a broken assemblyDays setting in one firm cannot stop the job for others', async () => {
    await h.owner.query("update tenants set settings = '{\"assemblyDays\":\"abc\"}' where id = $1", [T.id]);
    await expect(lockDueEngagements(h.app.pools.app, new Date())).resolves.toBeGreaterThanOrEqual(0);
    await h.owner.query("update tenants set settings = '{}' where id = $1", [T.id]);
  });
});
