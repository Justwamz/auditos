import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { withTenant } from '@auditos/db';
import { lockDueEngagements } from '../src/engagements/service';
import { harness, login, makeTenant, makeUser, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let partner: TestUser, manager: TestUser, staff: TestUser, admin: TestUser, eqr: TestUser;
let sP: Session, sM: Session, sS: Session, sAdmin: Session, sE: Session;
let clientId: string;
let engId: string;

const call = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

const declare = async (s: Session) =>
  expect((await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' })).statusCode).toBe(201);

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'eng');
  partner = await makeUser(h, T.id, 'partner', 4);
  manager = await makeUser(h, T.id, 'manager', 3);
  staff = await makeUser(h, T.id, 'staff', 1);
  eqr = await makeUser(h, T.id, 'eqr', 4);
  admin = await makeUser(h, T.id, 'firm_admin', 0);
  sP = await login(h, partner);
  sM = await login(h, manager);
  sS = await login(h, staff);
  sE = await login(h, eqr);
  sAdmin = await login(h, admin);
  await declare(sP);
  await declare(sM);

  const c = await call(sM, 'POST', '/clients', { name: 'Acme Traders Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 });
  clientId = c.json().id;
  const e = await call(sM, 'POST', '/engagements', { clientId, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: partner.id, riskFlags: ['fraud'] });
  engId = e.json().id;
});
afterAll(async () => h.close());

describe('clients', () => {
  test('only managers and partners create clients; sector is validated', async () => {
    expect((await call(sS, 'POST', '/clients', { name: 'X', sector: 'trading', legalForm: 'sole', yearEndMonth: 12 })).statusCode).toBe(403);
    expect((await call(sM, 'POST', '/clients', { name: 'X', sector: 'astrology', legalForm: 'sole', yearEndMonth: 12 })).statusCode).toBe(400);
    expect((await call(sM, 'POST', '/clients', { name: 'X', sector: 'rental', legalForm: 'sole', yearEndMonth: 13 })).statusCode).toBe(400);
  });
  test('a tenant only lists its own clients', async () => {
    const other = await makeTenant(h, 'eng-other');
    const o = await makeUser(h, other.id, 'manager', 3);
    const so = await login(h, o);
    await call(so, 'POST', '/clients', { name: 'Other Firm Client', sector: 'rental', legalForm: 'sole', yearEndMonth: 6 });
    const mine = (await call(sM, 'GET', '/clients')).json().clients.map((c: { name: string }) => c.name);
    expect(mine).toContain('Acme Traders Ltd');
    expect(mine).not.toContain('Other Firm Client');
  });
});

describe('engagement visibility and assignment', () => {
  test('visible only to assigned members; admin and unassigned staff get 404', async () => {
    expect((await call(sM, 'GET', `/engagements/${engId}`)).statusCode).toBe(200);
    expect((await call(sS, 'GET', `/engagements/${engId}`)).statusCode).toBe(404);
    expect((await call(sAdmin, 'GET', `/engagements/${engId}`)).statusCode).toBe(404);
    expect((await call(sS, 'GET', '/engagements')).json().engagements).toEqual([]);
  });

  test('assigning a user without a current independence declaration is rejected', async () => {
    const denied = await call(sM, 'POST', `/engagements/${engId}/members`, { userId: staff.id });
    expect(denied.statusCode).toBe(422);
    expect(denied.json().error).toBe('independence_declaration_required');
    await declare(sS);
    expect((await call(sM, 'POST', `/engagements/${engId}/members`, { userId: staff.id })).statusCode).toBe(201);
    expect((await call(sS, 'GET', `/engagements/${engId}`)).statusCode).toBe(200);
  });

  test('an expired independence declaration does not count', async () => {
    const lapsed = await makeUser(h, T.id, 'senior', 2);
    await ownerQuery(
      h,
      T.id,
      "insert into independence_declarations (tenant_id, user_id, statement, declared_at, expires_at) values ($1, $2, 'Lapsed declaration text', now() - interval '13 months', now() - interval '1 day')",
      [T.id, lapsed.id],
      lapsed.id,
    );
    expect((await call(sM, 'POST', `/engagements/${engId}/members`, { userId: lapsed.id })).statusCode).toBe(422);
  });

  test('only members of the engagement can add members', async () => {
    const stranger = await makeUser(h, T.id, 'manager', 3);
    const ss = await login(h, stranger);
    expect((await call(ss, 'POST', `/engagements/${engId}/members`, { userId: staff.id })).statusCode).toBe(404);
  });

  test('the engagement partner cannot be the EQR; a different eqr can', async () => {
    expect((await call(sP, 'POST', `/engagements/${engId}/eqr`, { userId: partner.id })).statusCode).toBe(403);
    await declare(sE);
    expect((await call(sP, 'POST', `/engagements/${engId}/eqr`, { userId: eqr.id })).statusCode).toBe(200);
    expect((await call(sE, 'GET', `/engagements/${engId}`)).statusCode).toBe(200);
  });

  test('only managers and partners can create engagements; period is validated', async () => {
    const body = { clientId, periodStart: '2027-01-01', periodEnd: '2027-12-31', partnerId: partner.id };
    expect((await call(sS, 'POST', '/engagements', body)).statusCode).toBe(403);
    expect((await call(sM, 'POST', '/engagements', { ...body, periodEnd: '2026-12-31' })).statusCode).toBe(400);
    expect((await call(sM, 'POST', '/engagements', { ...body, partnerId: staff.id })).statusCode).toBe(422);
  });
});

describe('state machine', () => {
  test('cannot skip states', async () => {
    const res = await call(sM, 'POST', `/engagements/${engId}/transition`, { to: 'fieldwork' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('invalid_transition');
  });

  test('a database trigger refuses a skipped state even if the API is bypassed', async () => {
    await expect(
      withTenant(h.app.pools.app, { tenantId: T.id, userId: manager.id }, (tx) =>
        tx.query("update engagements set state = 'completion' where id = $1", [engId]),
      ),
    ).rejects.toThrow(/invalid state transition/i);
  });

  const insertAt = async (state: string, daysAgo: number): Promise<string> => {
    const id = (await ownerQuery(h, T.id, 'select gen_random_uuid() as id')).rows[0].id as string;
    await ownerQuery(
      h,
      T.id,
      `insert into engagements (id, tenant_id, client_id, period_start, period_end, state, partner_id, report_date)
       values ($1, $2, $3, '2023-01-01', '2023-12-31', $4, $5, current_date - $6::int)`,
      [id, T.id, clientId, state, partner.id, daysAgo],
    );
    await ownerQuery(h, T.id, 'insert into engagement_members (tenant_id, engagement_id, user_id) values ($1, $2, $3)', [T.id, id, manager.id]);
    return id;
  };

  test('auto-lock locks engagements past the assembly deadline, logs it, and the lock is immutable', async () => {
    const id = await insertAt('report_issued', 61);
    const locked = await lockDueEngagements(h.app.pools.app, new Date());
    expect(locked).toBeGreaterThanOrEqual(1);
    const row = (await ownerQuery(h, T.id, 'select state, locked_at from engagements where id = $1', [id])).rows[0];
    expect(row.state).toBe('locked');
    expect(row.locked_at).not.toBeNull();
    const ev = await h.owner.query("select 1 from audit_events where tenant_id = $1 and action = 'engagement.auto_locked' and entity_id = $2", [T.id, id]);
    expect(ev.rowCount).toBe(1);
    await expect(
      withTenant(h.app.pools.app, { tenantId: T.id, userId: manager.id }, (tx) =>
        tx.query("update engagements set risk_profile = '{}' where id = $1", [id]),
      ),
    ).rejects.toThrow(/locked/i);
  });

  test('engagements inside the deadline are not locked', async () => {
    const id = await insertAt('report_issued', 10);
    await lockDueEngagements(h.app.pools.app, new Date());
    expect((await ownerQuery(h, T.id, 'select state from engagements where id = $1', [id])).rows[0].state).toBe('report_issued');
  });

  test('only report_issued engagements are auto-locked', async () => {
    const id = await insertAt('fieldwork', 400);
    await lockDueEngagements(h.app.pools.app, new Date());
    expect((await ownerQuery(h, T.id, 'select state from engagements where id = $1', [id])).rows[0].state).toBe('fieldwork');
  });
});
