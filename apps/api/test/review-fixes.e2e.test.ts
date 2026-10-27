import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { trading } from '../../../packages/fs-engine/test/fixtures';
import { signToken } from '../src/security/crypto';
import { csrfOnly, csvOf, harness, importTb, login, makeTenant, makeUser, ownerQuery, PASSWORD, stepUp, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let A: TestTenant;
let B: TestTenant;
let admin: TestUser, victim: TestUser, P: TestUser, P2: TestUser, M: TestUser, F: TestUser;
let sAdmin: Session, sP: Session, sP2: Session, sM: Session, sF: Session;
let clientId: string;

const call = (s: Session, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

const newEngagement = async (): Promise<string> => {
  const id = (await call(sM, 'POST', '/engagements', { clientId, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id as string;
  for (const u of [F, P2]) await call(sM, 'POST', `/engagements/${id}/members`, { userId: u.id });
  return id;
};

beforeAll(async () => {
  h = await harness();
  A = await makeTenant(h, 'fix-a');
  B = await makeTenant(h, 'fix-b');
  admin = await makeUser(h, A.id, 'firm_admin', 0);
  victim = await makeUser(h, B.id, 'partner', 4);
  P = await makeUser(h, A.id, 'partner', 4);
  P2 = await makeUser(h, A.id, 'partner', 4);
  M = await makeUser(h, A.id, 'manager', 3);
  F = await makeUser(h, A.id, 'staff', 1);
  sAdmin = await login(h, admin);
  sP = await login(h, P);
  sP2 = await login(h, P2);
  sM = await login(h, M);
  sF = await login(h, F);
  for (const s of [sP, sP2, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  clientId = (await call(sM, 'POST', '/clients', { name: 'Fix Client', sector: 'trading', legalForm: 'sole', yearEndMonth: 12 })).json().id;
});
afterAll(async () => h.close());

describe('invites cannot take over existing accounts', () => {
  test('inviting an email that already has an account returns no token and cannot change its password', async () => {
    const res = await call(sAdmin, 'POST', '/admin/users', { email: victim.email, role: 'partner' });
    expect(res.statusCode).toBe(201);
    expect(res.json().inviteToken).toBeNull();

    const fp = (await h.app.pools.app.query('select auth_user_fingerprint($1) as f', [victim.id])).rows[0].f as string;
    const forged = signToken({ uid: victim.id, purpose: 'invite', fp }, Date.now() + 60_000);
    const { csrf, cookie } = await csrfOnly(h);
    const accept = await h.app.inject({ method: 'POST', url: '/auth/accept-invite', headers: { 'x-csrf-token': csrf, cookie }, payload: { token: forged, password: 'attacker chosen password 1' } });
    expect(accept.statusCode).toBe(401);

    const still = await h.app.inject({ method: 'POST', url: '/auth/login', headers: { 'x-csrf-token': csrf, cookie }, payload: { email: victim.email, password: PASSWORD } });
    expect(still.statusCode).toBe(200);
  });
});

describe('reserved paper kinds belong to their own endpoints', () => {
  test('the generic endpoint refuses to create reserved kinds and to edit them', async () => {
    const e = await newEngagement();
    for (const kind of ['evidence', 'checklist', 'adjustments', 'trial_balance', 'fs_mapping', 'fs_note', 'trial_balance_prior']) {
      expect((await call(sF, 'POST', `/engagements/${e}/items`, { kind, title: 'x', content: {} })).statusCode, kind).toBe(400);
    }
    expect((await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'workpaper', title: 'ok', content: {} })).statusCode).toBe(201);

    await call(sF, 'POST', `/engagements/${e}/checklists/generate`);
    const cl = (await call(sF, 'GET', `/engagements/${e}/items?kind=checklist`)).json().items[0].id as string;
    const patch = await call(sF, 'PATCH', `/items/${cl}`, { content: { templateId: 'x', items: [] } });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error).toBe('dedicated_endpoint_required');
  });
});

describe('adjustments and transitions', () => {
  test('only a manager or partner can record an agreed adjustment', async () => {
    const e = await newEngagement();
    await importTb(h, sF, e, 'tb.csv', Buffer.from(csvOf(trading.tb)));
    const entry = (status: string) => ({ description: 'Accrual', status, lines: [{ code: '6000', debit: '100.00', credit: '0.00' }, { code: '2000', debit: '0.00', credit: '100.00' }] });
    expect((await call(sF, 'POST', `/engagements/${e}/adjustments`, entry('agreed'))).statusCode).toBe(403);
    expect((await call(sF, 'POST', `/engagements/${e}/adjustments`, entry('proposed'))).statusCode).toBe(201);
    expect((await call(sM, 'POST', `/engagements/${e}/adjustments`, entry('agreed'))).statusCode).toBe(201);
  });

  test('people adding adjustments at once all keep their entries', async () => {
    const e = await newEngagement();
    await importTb(h, sF, e, 'tb.csv', Buffer.from(csvOf(trading.tb)));
    const entry = (d: string) => ({ description: d, status: 'proposed', lines: [{ code: '6000', debit: '10.00', credit: '0.00' }, { code: '2000', debit: '0.00', credit: '10.00' }] });
    await call(sF, 'POST', `/engagements/${e}/adjustments`, entry('seed'));
    const rs = await Promise.all([call(sF, 'POST', `/engagements/${e}/adjustments`, entry('one')), call(sM, 'POST', `/engagements/${e}/adjustments`, entry('two')), call(sF, 'POST', `/engagements/${e}/adjustments`, entry('three'))]);
    expect(rs.map((r) => r.statusCode)).toEqual([201, 201, 201]);
    const list = (await call(sF, 'GET', `/engagements/${e}/adjustments`)).json().entries.map((x: { description: string }) => x.description).sort();
    expect(list).toEqual(['one', 'seed', 'three', 'two']);
  });

  test('approving, issuing and locking need the engagement partner and a fresh authenticator code', async () => {
    const e = await newEngagement();
    for (const s of ['planning', 'fieldwork', 'completion', 'review']) await ownerQuery(h, A.id, 'update engagements set state = $2 where id = $1', [e, s]);
    await stepUp(h, sP2, P2);
    expect((await call(sP2, 'POST', `/engagements/${e}/transition`, { to: 'partner_approved' })).statusCode).toBe(403);

    h.clock.t += 30_000;
    const fresh = await login(h, P);
    const noStepUp = await call(fresh, 'POST', `/engagements/${e}/transition`, { to: 'partner_approved' });
    expect(noStepUp.statusCode).toBe(401);
    expect(noStepUp.json().error).toBe('step_up_required');
    await stepUp(h, fresh, P);
    expect((await call(fresh, 'POST', `/engagements/${e}/transition`, { to: 'partner_approved' })).statusCode).toBe(200);
  });
});

describe('lockout ends sessions', () => {
  test('failed step-up attempts that lock the account also end its sessions', async () => {
    const u = await makeUser(h, A.id, 'staff', 1);
    const s = await login(h, u);
    for (let i = 0; i < 5; i++) await call(s, 'POST', '/auth/stepup', { code: '000000' });
    expect((await call(s, 'GET', '/me')).statusCode).toBe(401);
  });
});
