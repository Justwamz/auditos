import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { csrfOnly, harness, ownerQuery, login, makeTenant, makeUser, PASSWORD, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let A: TestTenant;
let B: TestTenant;
let adminA: TestUser;
let adminB: TestUser;
let sessA: Session;

beforeAll(async () => {
  process.env.PLATFORM_ADMIN_TOKEN ??= 'test-platform-token';
  h = await harness();
  A = await makeTenant(h, 'adminA');
  B = await makeTenant(h, 'adminB');
  adminA = await makeUser(h, A.id, 'firm_admin', 0);
  adminB = await makeUser(h, B.id, 'firm_admin', 0);
  sessA = await login(h, adminA);
});
afterAll(async () => h.close());

const call = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

describe('user administration', () => {
  test('firm_admin lists only own tenant users', async () => {
    const res = await call(sessA, 'GET', '/admin/users');
    expect(res.statusCode).toBe(200);
    const emails = res.json().users.map((u: { email: string }) => u.email);
    expect(emails).toContain(adminA.email);
    expect(emails).not.toContain(adminB.email);
  });

  test('a non-admin cannot use admin endpoints', async () => {
    const staff = await makeUser(h, A.id, 'staff', 1);
    const s = await login(h, staff);
    expect((await call(s, 'GET', '/admin/users')).statusCode).toBe(403);
    expect((await call(s, 'POST', '/admin/users', { email: 'x@example.test', role: 'staff' })).statusCode).toBe(403);
  });

  test('tenant A admin cannot patch a tenant B user (404)', async () => {
    const res = await call(sessA, 'PATCH', `/admin/users/${adminB.id}`, { active: false });
    expect(res.statusCode).toBe(404);
    expect((await ownerQuery(h, B.id, 'select active from memberships where user_id = $1', [adminB.id])).rows[0].active).toBe(true);
  });

  test('role change is audit logged and resets grade to the role default', async () => {
    const u = await makeUser(h, A.id, 'staff', 1);
    const res = await call(sessA, 'PATCH', `/admin/users/${u.id}`, { role: 'senior' });
    expect(res.statusCode).toBe(200);
    const m = (await ownerQuery(h, A.id, 'select role, grade from memberships where user_id = $1', [u.id])).rows[0];
    expect(m).toEqual({ role: 'senior', grade: 2 });
    const ev = (
      await h.owner.query("select detail from audit_events where tenant_id = $1 and action = 'UPDATE' and entity_id = $2", [A.id, u.id])
    ).rows;
    expect(ev.some((e) => e.detail.new.role === 'senior' && e.detail.old.role === 'staff')).toBe(true);
    expect(res.json().actorUserId).toBeUndefined();
  });

  test('deactivating a member revokes their sessions immediately', async () => {
    const u = await makeUser(h, A.id, 'staff', 1);
    const s = await login(h, u);
    expect((await call(s, 'GET', '/me')).statusCode).toBe(200);
    expect((await call(sessA, 'PATCH', `/admin/users/${u.id}`, { active: false })).statusCode).toBe(200);
    expect((await call(s, 'GET', '/me')).statusCode).toBe(401);
  });

  test('an admin cannot deactivate or demote themselves', async () => {
    expect((await call(sessA, 'PATCH', `/admin/users/${adminA.id}`, { active: false })).statusCode).toBe(409);
    expect((await call(sessA, 'PATCH', `/admin/users/${adminA.id}`, { role: 'staff' })).statusCode).toBe(409);
  });

  test('an unknown role is rejected', async () => {
    expect((await call(sessA, 'POST', '/admin/users', { email: 'x@example.test', role: 'root' })).statusCode).toBe(400);
  });
});

describe('invites', () => {
  test('invite, accept with a password once, then log in and enrol MFA', async () => {
    const email = `invitee-${Date.now()}@example.test`;
    const inv = await call(sessA, 'POST', '/admin/users', { email, role: 'manager' });
    expect(inv.statusCode).toBe(201);
    const { inviteToken } = inv.json();
    expect(typeof inviteToken).toBe('string');

    const { csrf, cookie } = await csrfOnly(h);
    const headers = { 'x-csrf-token': csrf, cookie };
    const weak = await h.app.inject({ method: 'POST', url: '/auth/accept-invite', headers, payload: { token: inviteToken, password: 'short' } });
    expect(weak.statusCode).toBe(400);
    const ok = await h.app.inject({ method: 'POST', url: '/auth/accept-invite', headers, payload: { token: inviteToken, password: PASSWORD } });
    expect(ok.statusCode).toBe(200);
    const reuse = await h.app.inject({ method: 'POST', url: '/auth/accept-invite', headers, payload: { token: inviteToken, password: `${PASSWORD}!!` } });
    expect(reuse.statusCode).toBe(401);

    const l = await h.app.inject({ method: 'POST', url: '/auth/login', headers, payload: { email, password: PASSWORD } });
    expect(l.statusCode).toBe(200);
    expect(l.json().mfaEnrolled).toBe(false);
  });

  test('a forged invite token is rejected', async () => {
    const { csrf, cookie } = await csrfOnly(h);
    const res = await h.app.inject({ method: 'POST', url: '/auth/accept-invite', headers: { 'x-csrf-token': csrf, cookie }, payload: { token: 'a.b', password: PASSWORD } });
    expect(res.statusCode).toBe(401);
  });

  test('re-inviting an existing member does not create a duplicate', async () => {
    const u = await makeUser(h, A.id, 'staff', 1);
    const res = await call(sessA, 'POST', '/admin/users', { email: u.email, role: 'staff' });
    expect(res.statusCode).toBe(201);
    const count = (await ownerQuery(h, A.id, 'select count(*)::int as n from memberships where user_id = $1', [u.id])).rows[0].n;
    expect(count).toBe(1);
  });
});

describe('platform provisioning', () => {
  const create = (headers: Record<string, string>, payload: object) =>
    h.app.inject({ method: 'POST', url: '/platform/tenants', headers, payload });

  test('rejects a missing or wrong token', async () => {
    expect((await create({}, { name: 'X Firm', adminEmail: 'a@example.test' })).statusCode).toBe(401);
    expect((await create({ 'x-platform-token': 'wrong' }, { name: 'X Firm', adminEmail: 'a@example.test' })).statusCode).toBe(401);
  });

  test('creates a tenant with a first firm_admin and an invite token', async () => {
    const email = `owner-${Date.now()}@example.test`;
    const res = await create({ 'x-platform-token': process.env.PLATFORM_ADMIN_TOKEN! }, { name: 'New Audit Firm', adminEmail: email });
    expect(res.statusCode).toBe(201);
    const { tenantId, inviteToken } = res.json();
    expect(inviteToken).toBeTruthy();
    const m = (await ownerQuery(h, tenantId, 'select role from memberships m join users u on u.id = m.user_id where m.tenant_id = $1 and u.email = $2', [tenantId, email])).rows[0];
    expect(m.role).toBe('firm_admin');
  });
});
