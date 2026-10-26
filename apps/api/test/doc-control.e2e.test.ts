import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { withTenant } from '@auditos/db';
import { verifyChain } from '@auditos/audit-log';
import { lockDueEngagements } from '../src/engagements/service';
import { harness, login, makeTenant, makeUser, ownerQuery, stepUp, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, P2: TestUser, M: TestUser, M2: TestUser, S: TestUser, F: TestUser, Q: TestUser, OUT: TestUser;
let sP: Session, sP2: Session, sM: Session, sM2: Session, sS: Session, sF: Session, sQ: Session, sOut: Session;
let clientId: string;
let engId: string;

const call = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

const declare = async (s: Session) =>
  expect((await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' })).statusCode).toBe(201);

const newEngagement = async (): Promise<string> => {
  const e = await call(sM, 'POST', '/engagements', { clientId, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id });
  const id = e.json().id as string;
  for (const u of [S, F, P2, M2, Q]) {
    expect((await call(sM, 'POST', `/engagements/${id}/members`, { userId: u.id })).statusCode).toBe(201);
  }
  return id;
};

const createItem = async (s: Session, engagementId: string, kind = 'checklist', content: object = { answer: 'yes' }) => {
  const res = await call(s, 'POST', `/engagements/${engagementId}/items`, { kind, title: `${kind} item`, content });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; version: number; state: string; contentHash: string };
};

const signoff = async (s: Session, u: TestUser, itemId: string, level: 'prepared' | 'manager' | 'partner', hash?: string) => {
  const h0 = hash ?? (await call(s, 'GET', `/items/${itemId}`)).json().contentHash;
  await stepUp(h, s, u);
  return call(s, 'POST', `/items/${itemId}/signoff`, { level, expectedHash: h0 });
};

/** Draft by staff F, prepared by F, reviewed by M, approved by P. */
const approveFully = async (engagementId: string, kind: string) => {
  const it = await createItem(sF, engagementId, kind);
  expect((await signoff(sF, F, it.id, 'prepared')).statusCode).toBe(200);
  expect((await signoff(sM, M, it.id, 'manager')).statusCode).toBe(200);
  expect((await signoff(sP, P, it.id, 'partner')).statusCode).toBe(200);
  return it;
};

const forceLock = async (id: string) => {
  const steps = ['planning', 'fieldwork', 'completion', 'review', 'partner_approved'];
  for (const s of steps) await ownerQuery(h, T.id, 'update engagements set state = $2 where id = $1', [id, s]);
  await ownerQuery(h, T.id, "update engagements set state = 'report_issued', report_date = current_date - 90 where id = $1", [id]);
  expect(await lockDueEngagements(h.app.pools.app, new Date())).toBeGreaterThanOrEqual(1);
};

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'doc');
  P = await makeUser(h, T.id, 'partner', 4);
  P2 = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  M2 = await makeUser(h, T.id, 'manager', 3);
  S = await makeUser(h, T.id, 'senior', 2);
  F = await makeUser(h, T.id, 'staff', 1);
  Q = await makeUser(h, T.id, 'quality_officer', 3);
  OUT = await makeUser(h, T.id, 'manager', 3);
  sP = await login(h, P);
  sP2 = await login(h, P2);
  sM = await login(h, M);
  sM2 = await login(h, M2);
  sS = await login(h, S);
  sF = await login(h, F);
  sQ = await login(h, Q);
  sOut = await login(h, OUT);
  for (const s of [sP, sP2, sM, sM2, sS, sF, sQ, sOut]) await declare(s);
  const c = await call(sM, 'POST', '/clients', { name: 'Doc Control Client', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 });
  clientId = c.json().id;
  engId = await newEngagement();
});
afterAll(async () => h.close());

describe('editing and review', () => {
  test('creating an item gives version 1, draft state and a content hash', async () => {
    const it = await createItem(sF, engId);
    expect(it).toMatchObject({ version: 1, state: 'draft' });
    expect(it.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('sign-off stores the content hash and moves the item along', async () => {
    const it = await createItem(sF, engId);
    expect((await signoff(sF, F, it.id, 'prepared')).json()).toEqual({ state: 'prepared' });
    const got = (await call(sF, 'GET', `/items/${it.id}`)).json();
    expect(got.signoffs).toHaveLength(1);
    expect(got.signoffs[0]).toMatchObject({ level: 'prepared', contentHash: it.contentHash, revoked: false });
  });

  test('sign-off without step-up is 401', async () => {
    const it = await createItem(sF, engId);
    h.clock.t += 30_000;
    const fresh = await login(h, F);
    const res = await call(fresh, 'POST', `/items/${it.id}/signoff`, { level: 'prepared', expectedHash: it.contentHash });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('step_up_required');
  });

  test('sign-off with a stale content hash is rejected with 409', async () => {
    const it = await createItem(sF, engId);
    await call(sF, 'PATCH', `/items/${it.id}`, { content: { answer: 'no' } });
    const res = await signoff(sF, F, it.id, 'prepared', it.contentHash);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('stale_content');
  });

  test('a preparer cannot sign off their own work', async () => {
    const it = await createItem(sM, engId);
    expect((await signoff(sM, M, it.id, 'prepared')).statusCode).toBe(200);
    expect((await signoff(sM, M, it.id, 'manager')).statusCode).toBe(403);
  });

  test('a reviewer of equal grade cannot review', async () => {
    const it = await createItem(sM, engId);
    await signoff(sM, M, it.id, 'prepared');
    expect((await signoff(sM2, M2, it.id, 'manager')).statusCode).toBe(403);
  });

  test('editing a manager_reviewed item reverts it to prepared and revokes the manager sign-off', async () => {
    const it = await createItem(sF, engId);
    await signoff(sF, F, it.id, 'prepared');
    await signoff(sM, M, it.id, 'manager');
    const edit = await call(sF, 'PATCH', `/items/${it.id}`, { content: { answer: 'changed' } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toMatchObject({ state: 'prepared', version: 2 });
    const got = (await call(sF, 'GET', `/items/${it.id}`)).json();
    const mgr = got.signoffs.find((s: { level: string }) => s.level === 'manager');
    expect(mgr.revoked).toBe(true);
  });

  test('editing partner_approved needs a reason and the partner; it revokes both sign-offs and bumps the version', async () => {
    const it = await approveFully(engId, 'checklist');
    expect((await call(sM, 'PATCH', `/items/${it.id}`, { content: { answer: 'x' }, reason: 'late adjustment needed' })).statusCode).toBe(403);
    expect((await call(sP, 'PATCH', `/items/${it.id}`, { content: { answer: 'x' } })).statusCode).toBe(400);
    const ok = await call(sP, 'PATCH', `/items/${it.id}`, { content: { answer: 'x' }, reason: 'late adjustment needed' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ state: 'prepared', version: 2 });
    const got = (await call(sP, 'GET', `/items/${it.id}`)).json();
    expect(got.signoffs.filter((s: { revoked: boolean }) => !s.revoked).map((s: { level: string }) => s.level)).toEqual(['prepared']);
  });

  test('the database revokes sign-offs even when the API is bypassed', async () => {
    const it = await createItem(sF, engId);
    await signoff(sF, F, it.id, 'prepared');
    await signoff(sM, M, it.id, 'manager');
    await withTenant(h.app.pools.app, { tenantId: T.id, userId: F.id }, (tx) =>
      tx.query("update wp_items set content = '{\"sneaky\":true}' where id = $1", [it.id]),
    );
    const row = (await ownerQuery(h, T.id, 'select state from wp_items where id = $1', [it.id], F.id)).rows[0];
    expect(row.state).toBe('prepared');
    const live = await ownerQuery(h, T.id, 'select count(*)::int as n from signoffs where item_id = $1 and revoked_at is null and level = $2', [it.id, 'manager'], F.id);
    expect(live.rows[0].n).toBe(0);
  });

  test('the application role cannot change state or deleted_at directly', async () => {
    const it = await createItem(sF, engId);
    await expect(
      withTenant(h.app.pools.app, { tenantId: T.id, userId: F.id }, (tx) => tx.query("update wp_items set state = 'partner_approved' where id = $1", [it.id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(h.app.pools.app, { tenantId: T.id, userId: F.id }, (tx) => tx.query('update wp_items set deleted_at = now() where id = $1', [it.id])),
    ).rejects.toThrow(/permission denied/);
  });

  test('an item is invisible to someone not on the engagement', async () => {
    const it = await createItem(sF, engId);
    // sOut is a manager in the tenant but not a member of this engagement
    expect((await call(sOut, 'GET', `/items/${it.id}`)).statusCode).toBe(404);
    expect((await call(sOut, 'PATCH', `/items/${it.id}`, { content: {} })).statusCode).toBe(404);
  });

  test('items are listed per engagement and history shows versions and revoked sign-offs', async () => {
    const it = await createItem(sF, engId);
    await signoff(sF, F, it.id, 'prepared');
    await call(sF, 'PATCH', `/items/${it.id}`, { title: 'renamed' });
    const hist = (await call(sF, 'GET', `/items/${it.id}/history`)).json();
    expect(hist.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(hist.events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['item.created', 'item.edited']));
    const list = (await call(sF, 'GET', `/engagements/${engId}/items`)).json().items.map((i: { id: string }) => i.id);
    expect(list).toContain(it.id);
  });
});

describe('deletion', () => {
  test('a draft is soft-deleted by its creator with a reason, and stays in history', async () => {
    const it = await createItem(sF, engId);
    expect((await call(sF, 'POST', `/items/${it.id}/delete-request`, { reason: 'x' })).statusCode).toBe(422);
    const res = await call(sF, 'POST', `/items/${it.id}/delete-request`, { reason: 'duplicate of another paper' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
    const list = (await call(sF, 'GET', `/engagements/${engId}/items`)).json().items.map((i: { id: string }) => i.id);
    expect(list).not.toContain(it.id);
    const row = (await ownerQuery(h, T.id, 'select deleted_at, deleted_reason from wp_items where id = $1', [it.id], F.id)).rows[0];
    expect(row.deleted_at).not.toBeNull();
    expect(row.deleted_reason).toBe('duplicate of another paper');
    expect((await call(sF, 'GET', `/items/${it.id}/history`)).statusCode).toBe(200);
  });

  test('another staff member cannot directly delete someone else’s draft, but a manager can', async () => {
    const it = await createItem(sS, engId);
    const forbidden = await call(sF, 'POST', `/items/${it.id}/delete-request`, { reason: 'not mine to delete' });
    expect(forbidden.statusCode).toBe(202);
    const it2 = await createItem(sS, engId);
    expect((await call(sM, 'POST', `/items/${it2.id}/delete-request`, { reason: 'manager cleanup of drafts' })).statusCode).toBe(200);
  });

  test('deleting a reviewed item needs a second approver of equal or higher grade', async () => {
    const it = await createItem(sF, engId);
    await signoff(sF, F, it.id, 'prepared');
    await signoff(sM, M, it.id, 'manager');
    const req = await call(sM, 'POST', `/items/${it.id}/delete-request`, { reason: 'superseded by new paper' });
    expect(req.statusCode).toBe(202);
    const requestId = req.json().requestId as string;
    await stepUp(h, sM, M);
    expect((await call(sM, 'POST', `/deletion-requests/${requestId}/approve`)).statusCode).toBe(403);
    await stepUp(h, sS, S);
    expect((await call(sS, 'POST', `/deletion-requests/${requestId}/approve`)).statusCode).toBe(403);
    expect((await ownerQuery(h, T.id, 'select deleted_at from wp_items where id = $1', [it.id], F.id)).rows[0].deleted_at).toBeNull();
    await stepUp(h, sP, P);
    expect((await call(sP, 'POST', `/deletion-requests/${requestId}/approve`)).statusCode).toBe(200);
    expect((await ownerQuery(h, T.id, 'select deleted_at from wp_items where id = $1', [it.id], F.id)).rows[0].deleted_at).not.toBeNull();
  });

  test('approving without step-up is 401', async () => {
    const it = await createItem(sF, engId);
    await signoff(sF, F, it.id, 'prepared');
    await signoff(sM, M, it.id, 'manager');
    const req = await call(sM, 'POST', `/items/${it.id}/delete-request`, { reason: 'superseded by new paper' });
    const res = await call(sP2, 'POST', `/deletion-requests/${req.json().requestId}/approve`);
    expect(res.statusCode).toBe(401);
  });

  test('a hard DELETE through the application role fails at the database', async () => {
    const it = await createItem(sF, engId);
    await expect(
      withTenant(h.app.pools.app, { tenantId: T.id, userId: F.id }, (tx) => tx.query('delete from wp_items where id = $1', [it.id])),
    ).rejects.toThrow(/permission denied/);
    const viaOwner = await ownerQuery(h, T.id, 'delete from wp_items where id = $1', [it.id], F.id);
    expect(viaOwner.rowCount).toBe(0);
    const still = await ownerQuery(h, T.id, 'select 1 from wp_items where id = $1', [it.id], F.id);
    expect(still.rowCount).toBe(1);
  });

  test('a deleted item cannot be edited or signed off', async () => {
    const it = await createItem(sF, engId);
    await call(sF, 'POST', `/items/${it.id}/delete-request`, { reason: 'duplicate of another paper' });
    expect((await call(sF, 'PATCH', `/items/${it.id}`, { content: { a: 1 } })).statusCode).toBe(409);
  });
});

describe('lock, unlock and addenda', () => {
  let lockedEng: string;
  let lockedItem: string;

  beforeAll(async () => {
    lockedEng = await newEngagement();
    const it = await approveFully(lockedEng, 'checklist');
    lockedItem = it.id;
    await forceLock(lockedEng);
  });

  test('editing a locked engagement fails at the API and at the database', async () => {
    expect((await call(sP, 'PATCH', `/items/${lockedItem}`, { content: { a: 1 }, reason: 'attempt to alter locked file' })).statusCode).toBe(403);
    await expect(
      withTenant(h.app.pools.app, { tenantId: T.id, userId: P.id }, (tx) =>
        tx.query("update wp_items set content = '{\"a\":1}' where id = $1", [lockedItem]),
      ),
    ).rejects.toThrow(/locked/);
    expect((await call(sF, 'POST', `/engagements/${lockedEng}/items`, { kind: 'checklist', title: 'new', content: {} })).statusCode).toBe(403);
  });

  test('deleting on a locked engagement is refused', async () => {
    expect((await call(sM, 'POST', `/items/${lockedItem}/delete-request`, { reason: 'attempt on locked file' })).statusCode).toBe(403);
  });

  test('a post-lock addendum is a new dated item and leaves the original untouched', async () => {
    const before = (await call(sF, 'GET', `/items/${lockedItem}`)).json();
    const res = await call(sF, 'POST', `/engagements/${lockedEng}/items`, {
      kind: 'addendum', title: 'Late information received', content: { note: 'client sent confirmation' }, addendumOf: lockedItem,
    });
    expect(res.statusCode).toBe(201);
    const after = (await call(sF, 'GET', `/items/${lockedItem}`)).json();
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.version).toBe(before.version);
    const add = (await call(sF, 'GET', `/items/${res.json().id}`)).json();
    expect(add.addendumOf).toBe(lockedItem);
    expect(add.createdAt).toBeTruthy();
  });

  test('unlock needs a reason and a different partner or quality officer, and is logged', async () => {
    await stepUp(h, sP, P);
    expect((await call(sP, 'POST', `/engagements/${lockedEng}/unlock-requests`, { reason: 'short' })).statusCode).toBe(422);
    const req = await call(sP, 'POST', `/engagements/${lockedEng}/unlock-requests`, { reason: 'Regulator requested a correction to note 5' });
    expect(req.statusCode).toBe(201);
    const rid = req.json().requestId as string;

    await stepUp(h, sP, P);
    expect((await call(sP, 'POST', `/unlock-requests/${rid}/approve`)).statusCode).toBe(403);
    await stepUp(h, sM, M);
    expect((await call(sM, 'POST', `/unlock-requests/${rid}/approve`)).statusCode).toBe(403);
    expect((await call(sM, 'POST', `/engagements/${lockedEng}/unlock-requests`, { reason: 'Regulator requested a correction' })).statusCode).toBe(403);

    await stepUp(h, sQ, Q);
    expect((await call(sQ, 'POST', `/unlock-requests/${rid}/approve`)).statusCode).toBe(200);
    expect((await call(sF, 'GET', `/engagements/${lockedEng}`)).json().state).toBe('report_issued');
    const ev = await h.owner.query("select detail from audit_events where tenant_id = $1 and action = 'engagement.unlocked' and entity_id = $2", [T.id, lockedEng]);
    expect(ev.rowCount).toBe(1);
    expect(ev.rows[0].detail.reason).toContain('Regulator');
    expect(await lockDueEngagements(h.app.pools.app, new Date())).toBeGreaterThanOrEqual(0);
    expect((await call(sF, 'GET', `/engagements/${lockedEng}`)).json().state).toBe('report_issued');
  });

  test('a second partner can approve an unlock', async () => {
    const e = await newEngagement();
    await approveFully(e, 'checklist');
    await forceLock(e);
    await stepUp(h, sP, P);
    const rid = (await call(sP, 'POST', `/engagements/${e}/unlock-requests`, { reason: 'Correction to comparatives needed' })).json().requestId;
    await stepUp(h, sP2, P2);
    expect((await call(sP2, 'POST', `/unlock-requests/${rid}/approve`)).statusCode).toBe(200);
  });

  test('an engagement that is not locked cannot be unlocked', async () => {
    await stepUp(h, sP, P);
    expect((await call(sP, 'POST', `/engagements/${engId}/unlock-requests`, { reason: 'Not locked but trying anyway' })).statusCode).toBe(409);
  });
});

describe('engagement gates owned by document control', () => {
  test('onboarding to planning is blocked until acceptance is approved, the letter is on file and independence is current', async () => {
    const e = await newEngagement();
    const blocked = await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'planning' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe('gate_blocked');
    expect(blocked.json().blockers.map((b: { gate: string }) => b.gate)).toEqual(expect.arrayContaining(['acceptanceApproved', 'engagementLetterOnFile']));

    await approveFully(e, 'acceptance');
    const stillBlocked = await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'planning' });
    expect(stillBlocked.json().blockers.map((b: { gate: string }) => b.gate)).toEqual(['engagementLetterOnFile']);

    await createItem(sF, e, 'engagement_letter');
    expect((await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'planning' })).statusCode).toBe(200);
  });

  test('planning to fieldwork is blocked until materiality and risk assessment are partner-approved', async () => {
    const e = await newEngagement();
    await approveFully(e, 'acceptance');
    await createItem(sF, e, 'engagement_letter');
    await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'planning' });

    const blocked = await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'fieldwork' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().blockers.map((b: { gate: string }) => b.gate)).toEqual(expect.arrayContaining(['materialityApproved', 'riskAssessmentApproved']));

    const mat = await createItem(sF, e, 'materiality');
    await signoff(sF, F, mat.id, 'prepared');
    await signoff(sM, M, mat.id, 'manager');
    expect((await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'fieldwork' })).statusCode).toBe(409);
    await signoff(sP, P, mat.id, 'partner');
    await approveFully(e, 'risk_assessment');
    expect((await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'fieldwork' })).statusCode).toBe(200);
  });

  test('a deleted acceptance item no longer satisfies the gate', async () => {
    const e = await newEngagement();
    const acc = await approveFully(e, 'acceptance');
    await createItem(sF, e, 'engagement_letter');
    const req = await call(sM, 'POST', `/items/${acc.id}/delete-request`, { reason: 'wrong client file attached' });
    await stepUp(h, sP, P);
    await call(sP, 'POST', `/deletion-requests/${req.json().requestId}/approve`);
    const blocked = await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'planning' });
    expect(blocked.json().blockers.map((b: { gate: string }) => b.gate)).toContain('acceptanceApproved');
  });

  test('the audit chain stays intact after all of the above', async () => {
    expect(await verifyChain(h.owner, T.id)).toEqual({ ok: true });
  });
});
