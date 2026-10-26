import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { codeNow, csrfOnly, harness, login, makeTenant, makeUser, PASSWORD, type Harness } from './helpers';
import type { TestTenant } from '@auditos/db/testing';
import { buildApp } from '../src/app';

let h: Harness;
let t: TestTenant;

beforeAll(async () => {
  h = await harness();
  t = await makeTenant(h, 'auth');
});
afterAll(async () => h.close());

const post = async (url: string, payload: unknown, headers: Record<string, string> = {}) => {
  const { csrf, cookie } = await csrfOnly(h);
  return h.app.inject({ method: 'POST', url, payload: payload as object, headers: { 'x-csrf-token': csrf, cookie, ...headers } });
};

describe('login and MFA', () => {
  test('login without MFA verify gets no session', async () => {
    const u = await makeUser(h, t.id, 'staff', 1);
    const res = await post('/auth/login', { email: u.email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mfaRequired: true, mfaEnrolled: true });
    expect(res.cookies.find((c) => c.name === 'aos_session')).toBeUndefined();
    expect((await h.app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
  });

  test('wrong password locks after 5 failures with the same generic error as an unknown email', async () => {
    const u = await makeUser(h, t.id, 'staff', 1);
    let last;
    for (let i = 0; i < 5; i++) last = await post('/auth/login', { email: u.email, password: 'nope' });
    const unknown = await post('/auth/login', { email: 'ghost@example.test', password: 'nope' });
    expect(last?.statusCode).toBe(401);
    expect(last?.json()).toEqual(unknown.json());
    const row = (await h.owner.query('select failed_logins, locked_until from users where id = $1', [u.id])).rows[0];
    expect(row.failed_logins).toBe(5);
    expect(row.locked_until).not.toBeNull();
    const correctButLocked = await post('/auth/login', { email: u.email, password: PASSWORD });
    expect(correctButLocked.statusCode).toBe(401);
    expect(correctButLocked.json()).toEqual(unknown.json());
  });

  test('valid TOTP completes login, sets an HttpOnly cookie and writes audit events', async () => {
    const u = await makeUser(h, t.id, 'senior', 2);
    const s = await login(h, u);
    const me = await h.app.inject({ method: 'GET', url: '/me', headers: s.headers });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ userId: u.id, email: u.email });
    const res = await post('/auth/login', { email: u.email, password: PASSWORD });
    const verify = await post('/auth/mfa/verify', { challengeId: res.json().challengeId, code: codeNow(u.secret, h.clock, 1) });
    const cookie = verify.cookies.find((c) => c.name === 'aos_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(String(cookie?.sameSite).toLowerCase()).toBe('lax');
    const events = (await h.owner.query("select action from audit_events where tenant_id = $1 and action like 'auth.%'", [t.id])).rows.map((r) => r.action);
    expect(events).toContain('auth.login');
  });

  test('a TOTP code cannot be replayed', async () => {
    const u = await makeUser(h, t.id, 'staff', 1);
    const code = codeNow(u.secret, h.clock);
    const l1 = await post('/auth/login', { email: u.email, password: PASSWORD });
    expect((await post('/auth/mfa/verify', { challengeId: l1.json().challengeId, code })).statusCode).toBe(200);
    const l2 = await post('/auth/login', { email: u.email, password: PASSWORD });
    expect((await post('/auth/mfa/verify', { challengeId: l2.json().challengeId, code })).statusCode).toBe(401);
  });

  test('a user without MFA enrols with a code from the issued secret', async () => {
    const u = await makeUser(h, t.id, 'staff', 1, { mfa: false });
    const l = await post('/auth/login', { email: u.email, password: PASSWORD });
    expect(l.json().mfaEnrolled).toBe(false);
    const enrol = await post('/auth/mfa/enroll', { challengeId: l.json().challengeId });
    expect(enrol.statusCode).toBe(200);
    const { secret, otpauthUri } = enrol.json();
    expect(otpauthUri).toContain('otpauth://totp/');
    const v = await post('/auth/mfa/verify', { challengeId: l.json().challengeId, code: codeNow(secret, h.clock) });
    expect(v.statusCode).toBe(200);
    expect((await h.owner.query('select mfa_enabled from users where id = $1', [u.id])).rows[0].mfa_enabled).toBe(true);
    const again = await post('/auth/mfa/enroll', { challengeId: l.json().challengeId });
    expect(again.statusCode).toBe(409);
  });

  test('a challenge with a wrong code is rejected and counts as a failure', async () => {
    const u = await makeUser(h, t.id, 'staff', 1);
    const l = await post('/auth/login', { email: u.email, password: PASSWORD });
    const bad = await post('/auth/mfa/verify', { challengeId: l.json().challengeId, code: '000000' });
    expect(bad.statusCode).toBe(401);
    expect((await h.owner.query('select failed_logins from users where id = $1', [u.id])).rows[0].failed_logins).toBe(1);
  });

  test('a forged challenge id is rejected', async () => {
    expect((await post('/auth/mfa/verify', { challengeId: 'forged.token', code: '123456' })).statusCode).toBe(401);
  });
});

describe('sessions', () => {
  test('/me rejects an expired idle session', async () => {
    const u = await makeUser(h, t.id, 'staff', 1);
    const s = await login(h, u);
    await h.owner.query("update sessions set last_seen_at = now() - interval '31 minutes' where user_id = $1", [u.id]);
    expect((await h.app.inject({ method: 'GET', url: '/me', headers: s.headers })).statusCode).toBe(401);
  });

  test('a deactivated user loses access immediately', async () => {
    const u = await makeUser(h, t.id, 'staff', 1);
    const s = await login(h, u);
    await h.owner.query('update users set active = false where id = $1', [u.id]);
    expect((await h.app.inject({ method: 'GET', url: '/me', headers: s.headers })).statusCode).toBe(401);
  });

  test('logout revokes the session', async () => {
    const u = await makeUser(h, t.id, 'staff', 1);
    const s = await login(h, u);
    expect((await h.app.inject({ method: 'POST', url: '/auth/logout', headers: s.headers })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/me', headers: s.headers })).statusCode).toBe(401);
  });

  test('a user with one membership is placed in that tenant; with two, must select', async () => {
    const other = await makeTenant(h, 'second');
    const u = await makeUser(h, t.id, 'manager', 3);
    const owner2 = await h.owner.connect();
    try {
      await owner2.query('BEGIN');
      await owner2.query("select set_config('app.tenant_id', $1, true)", [other.id]);
      await owner2.query("insert into memberships (tenant_id, user_id, role, grade) values ($1, $2, 'staff', 1)", [other.id, u.id]);
      await owner2.query('COMMIT');
    } finally {
      owner2.release();
    }
    const s = await login(h, u);
    const me = (await h.app.inject({ method: 'GET', url: '/me', headers: s.headers })).json();
    expect(me.activeTenantId).toBeNull();
    expect(me.memberships).toHaveLength(2);
    const sel = await h.app.inject({ method: 'POST', url: '/auth/select-tenant', headers: s.headers, payload: { tenantId: other.id } });
    expect(sel.statusCode).toBe(200);
    const me2 = (await h.app.inject({ method: 'GET', url: '/me', headers: s.headers })).json();
    expect(me2).toMatchObject({ activeTenantId: other.id, role: 'staff' });
    const bad = await h.app.inject({ method: 'POST', url: '/auth/select-tenant', headers: s.headers, payload: { tenantId: '00000000-0000-4000-8000-000000000000' } });
    expect(bad.statusCode).toBe(403);
  });
});

describe('step-up', () => {
  test('step-up routes need a fresh second factor', async () => {
    const u = await makeUser(h, t.id, 'partner', 4);
    const s = await login(h, u);
    const denied = await h.app.inject({ method: 'GET', url: '/test/sensitive', headers: s.headers });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error).toBe('step_up_required');
    h.clock.t += 31_000;
    const up = await h.app.inject({ method: 'POST', url: '/auth/stepup', headers: s.headers, payload: { code: codeNow(u.secret, h.clock) } });
    expect(up.statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/test/sensitive', headers: s.headers })).statusCode).toBe(200);
  });
});

describe('security baseline', () => {
  test('state-changing request without CSRF header is 403', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a@example.test', password: 'x' } });
    expect(res.statusCode).toBe(403);
    const { csrf } = await csrfOnly(h);
    const mismatch = await h.app.inject({ method: 'POST', url: '/auth/login', headers: { 'x-csrf-token': 'other', cookie: `aos_csrf=${csrf}` }, payload: {} });
    expect(mismatch.statusCode).toBe(403);
  });

  test('security headers are present', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('no stack trace in a 500 body', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret internals');
    expect(res.body).not.toContain('file.ts');
    expect(res.json()).toEqual({ error: 'internal' });
  });

  test('a route without an access declaration fails at registration', async () => {
    const unready = await buildApp({ pools: h.app.pools });
    expect(() => unready.get('/test/undeclared', async () => 1)).toThrow(/config\.access/);
    await unready.close();
  });

  test('an authenticated route rejects anonymous callers', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
  });

  test('a malformed body is a 400 and not a 500', async () => {
    const res = await post('/auth/login', { email: 123, password: null });
    expect(res.statusCode).toBe(400);
  });
});

describe('rate limiting', () => {
  test('login returns 429 after 10 attempts per minute per IP', async () => {
    const h2 = await harness({ loginRateLimit: 10 });
    try {
      const { csrf, cookie } = await csrfOnly(h2);
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) {
        const r = await h2.app.inject({ method: 'POST', url: '/auth/login', headers: { 'x-csrf-token': csrf, cookie }, payload: { email: 'x@example.test', password: 'x' } });
        codes.push(r.statusCode);
      }
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    } finally {
      await h2.close();
    }
  });
});
