import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createPools } from '@auditos/db';
import { addTestMember, createTestTenant, type TestTenant } from '@auditos/db/testing';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/security/password';
import { encrypt } from '../src/security/crypto';
import { generateSecret, stepOf, totpAt } from '../src/security/totp';

export const PASSWORD = 'correct horse battery staple 42';

export interface Harness {
  app: FastifyInstance;
  owner: Pool;
  clock: { t: number };
  close: () => Promise<void>;
}

async function testRoutes(app: FastifyInstance): Promise<void> {
  app.get('/test/sensitive', { config: { access: 'tenant', stepUp: true } }, async () => ({ ok: true }));
  app.get('/test/boom', { config: { access: 'public' } }, async () => {
    throw new Error('secret internals at C:\src\file.ts');
  });
}

export async function harness(opts: { loginRateLimit?: number } = {}): Promise<Harness> {
  const { owner, app: appPool } = createPools();
  const clock = { t: Date.now() };
  const env = { ...process.env, LOGIN_RATE_LIMIT: String(opts.loginRateLimit ?? 1000) };
  const app = await buildApp({ env, pools: { app: appPool }, now: () => clock.t, routes: [testRoutes] });
  return {
    app,
    owner,
    clock,
    close: async () => {
      await app.close();
      await owner.end();
      await appPool.end();
    },
  };
}

export interface TestUser {
  id: string;
  email: string;
  secret: string;
}

export async function makeUser(
  h: Harness,
  tenantId: string,
  role: string,
  grade: number,
  opts: { mfa?: boolean } = {},
): Promise<TestUser> {
  const id = await addTestMember(h.owner, tenantId, `u-${role}`, role, grade);
  const secret = generateSecret();
  const hash = await hashPassword(PASSWORD);
  const mfa = opts.mfa ?? true;
  await h.owner.query(
    'update users set password_hash = $2, mfa_secret_enc = $3, mfa_enabled = $4 where id = $1',
    [id, hash, mfa ? encrypt(secret, process.env) : null, mfa],
  );
  const email = (await h.owner.query('select email from users where id = $1', [id])).rows[0].email as string;
  return { id, email, secret };
}

export async function makeTenant(h: Harness, label: string): Promise<TestTenant> {
  return createTestTenant(h.owner, label);
}

export const codeNow = (secret: string, clock: { t: number }, stepOffset = 0): string =>
  totpAt(secret, stepOf(clock.t) + stepOffset);

export interface Session {
  cookie: string;
  csrf: string;
  headers: Record<string, string>;
}

export async function csrfOnly(h: Harness): Promise<{ csrf: string; cookie: string }> {
  const res = await h.app.inject({ method: 'GET', url: '/auth/csrf' });
  const csrf = res.json().token as string;
  return { csrf, cookie: `aos_csrf=${csrf}` };
}

/** Full login (password + TOTP). Returns request headers for authenticated calls. */
export async function login(h: Harness, user: TestUser): Promise<Session> {
  const { csrf, cookie: csrfCookie } = await csrfOnly(h);
  const headers = { 'x-csrf-token': csrf, cookie: csrfCookie };
  const l = await h.app.inject({ method: 'POST', url: '/auth/login', headers, payload: { email: user.email, password: PASSWORD } });
  if (l.statusCode !== 200) throw new Error(`login failed: ${l.statusCode} ${l.body}`);
  const v = await h.app.inject({
    method: 'POST',
    url: '/auth/mfa/verify',
    headers,
    payload: { challengeId: l.json().challengeId, code: codeNow(user.secret, h.clock) },
  });
  if (v.statusCode !== 200) throw new Error(`mfa failed: ${v.statusCode} ${v.body}`);
  const session = v.cookies.find((c) => c.name === 'aos_session');
  if (!session) throw new Error('no session cookie');
  const cookie = `aos_csrf=${csrf}; aos_session=${session.value}`;
  return { cookie, csrf, headers: { cookie, 'x-csrf-token': csrf } };
}

/** Owner-side query with a tenant context set (needed for tables with forced RLS). */
export async function ownerQuery(h: Harness, tenantId: string, sql: string, params: unknown[] = [], userId?: string) {
  const c = await h.owner.connect();
  try {
    await c.query('BEGIN');
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    if (userId) await c.query("select set_config('app.user_id', $1, true)", [userId]);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
