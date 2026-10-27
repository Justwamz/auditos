import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { appendEvent } from '@auditos/audit-log';
import { withTenant, withUser } from '@auditos/db';
import { decrypt, encrypt, randomToken, sha256Hex, signToken, verifyToken } from '../security/crypto';
import { burnPasswordCheck, verifyPassword } from '../security/password';
import { generateSecret, otpauthUri, verifyTotp } from '../security/totp';

const GENERIC = { error: 'invalid_credentials' } as const;
const CHALLENGE_MS = 5 * 60_000;

const loginBody = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(512) });
const challengeBody = z.object({ challengeId: z.string().min(1).max(1024) });
const verifyBody = challengeBody.extend({ code: z.string().max(12) });
const stepUpBody = z.object({ code: z.string().max(12) });
const selectBody = z.object({ tenantId: z.string().uuid() });

interface UserRow {
  id: string;
  email?: string;
  password_hash?: string;
  mfa_secret_enc: string | null;
  mfa_enabled: boolean;
  active: boolean;
  locked_until: Date | null;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;
  const cfg = app.cfg;
  const secure = cfg.isProd;

  const tenantsOf = (userId: string) =>
    withUser(pool, userId, async (tx) =>
      (await tx.query('select tenant_id from memberships where user_id = $1 and active', [userId])).rows.map((r) => r.tenant_id as string),
    );

  /** Writes an auth event to every tenant chain the user belongs to. */
  const auditUser = async (userId: string, action: string, detail: unknown = {}) => {
    for (const tenantId of await tenantsOf(userId)) {
      await withTenant(pool, { tenantId, userId }, (tx) => appendEvent(tx, { action, entityType: 'auth', entityId: userId, detail }));
    }
  };

  const isLocked = (u: UserRow) => u.locked_until !== null && u.locked_until.getTime() > Date.now();

  const userFromChallenge = async (challengeId: string): Promise<UserRow | null> => {
    const data = verifyToken<{ uid: string }>(challengeId, app.now());
    if (!data || typeof data.uid !== 'string') return null;
    const u = (await pool.query('select * from auth_user_by_id($1)', [data.uid])).rows[0] as UserRow | undefined;
    return u && u.active && !isLocked(u) ? u : null;
  };

  const fail = async (u: UserRow, action: string) => {
    const locked = (await pool.query('select auth_record_failure($1, $2, $3) as locked', [u.id, cfg.maxFailedLogins, cfg.lockMinutes])).rows[0]?.locked;
    await auditUser(u.id, action);
    if (locked) await auditUser(u.id, 'auth.locked', { minutes: cfg.lockMinutes });
  };

  const setCookies = (reply: FastifyReply, csrf: string, session?: string) => {
    reply.setCookie('aos_csrf', csrf, { path: '/', sameSite: 'lax', secure, httpOnly: false });
    if (session) reply.setCookie('aos_session', session, { path: '/', sameSite: 'lax', secure, httpOnly: true });
  };

  app.get('/health', { config: { access: 'public' } }, async () => ({ ok: true }));

  app.get('/auth/csrf', { config: { access: 'public' } }, async (req, reply) => {
    const token = req.cookies.aos_csrf || randomToken(24);
    setCookies(reply, token);
    return { token };
  });

  app.post('/auth/login', { config: { access: 'public', rateLimit: { max: cfg.loginRateLimit, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = loginBody.parse(req.body);
    const u = (await pool.query('select * from auth_lookup($1)', [body.email])).rows[0] as UserRow | undefined;
    if (!u) {
      await burnPasswordCheck(body.password);
      return reply.code(401).send(GENERIC);
    }
    const ok = await verifyPassword(u.password_hash ?? '', body.password);
    if (!u.active || isLocked(u)) return reply.code(401).send(GENERIC);
    if (!ok) {
      await fail(u, 'auth.login_failed');
      return reply.code(401).send(GENERIC);
    }
    const challengeId = signToken({ uid: u.id }, app.now() + CHALLENGE_MS);
    return { mfaRequired: true, mfaEnrolled: u.mfa_enabled, challengeId };
  });

  app.post('/auth/mfa/enroll', { config: { access: 'public', rateLimit: { max: cfg.loginRateLimit * 2, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { challengeId } = challengeBody.parse(req.body);
    const u = await userFromChallenge(challengeId);
    if (!u) return reply.code(401).send(GENERIC);
    if (u.mfa_enabled) return reply.code(409).send({ error: 'already_enrolled' });
    const secret = u.mfa_secret_enc ? decrypt(u.mfa_secret_enc) : generateSecret();
    if (!u.mfa_secret_enc) await pool.query('select auth_begin_mfa($1, $2)', [u.id, encrypt(secret)]);
    return { secret, otpauthUri: otpauthUri(secret, u.email ?? 'user', 'AuditOS') };
  });

  app.post('/auth/mfa/verify', { config: { access: 'public', rateLimit: { max: cfg.loginRateLimit * 2, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = verifyBody.parse(req.body);
    const u = await userFromChallenge(body.challengeId);
    if (!u || !u.mfa_secret_enc) return reply.code(401).send(GENERIC);
    const step = cfg.devFixedOtp && body.code === cfg.devFixedOtp ? ('fixed' as const) : verifyTotp(decrypt(u.mfa_secret_enc), body.code, app.now());
    if (step === null) {
      await fail(u, 'auth.mfa_failed');
      return reply.code(401).send(GENERIC);
    }
    const fresh = step === 'fixed' || (await pool.query('select auth_accept_totp_step($1, $2) as ok', [u.id, step])).rows[0]?.ok;
    if (!fresh) return reply.code(401).send(GENERIC);
    if (!u.mfa_enabled) await pool.query('select auth_enable_mfa($1)', [u.id]);
    await pool.query('select auth_record_success($1)', [u.id]);

    const token = randomToken(32);
    await pool.query('select session_create($1, $2, $3, $4, $5)', [
      u.id,
      sha256Hex(token),
      cfg.absoluteHours,
      req.ip,
      String(req.headers['user-agent'] ?? ''),
    ]);
    setCookies(reply, req.cookies.aos_csrf || randomToken(24), token);
    const loaded = (await pool.query('select * from session_load($1, $2)', [sha256Hex(token), cfg.idleMinutes])).rows[0];
    if (loaded?.tenant_id) {
      await withTenant(pool, { tenantId: loaded.tenant_id, userId: u.id }, (tx) =>
        appendEvent(tx, { action: 'auth.login', entityType: 'auth', entityId: u.id, detail: { ip: req.ip } }),
      );
    }
    return { ok: true };
  });

  app.post('/auth/stepup', { config: { access: 'user', rateLimit: { max: cfg.loginRateLimit * 2, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { code } = stepUpBody.parse(req.body);
    const a = req.auth!;
    const u = (await pool.query('select * from auth_user_by_id($1)', [a.userId])).rows[0] as UserRow | undefined;
    if (!u?.mfa_secret_enc) return reply.code(401).send(GENERIC);
    const step = cfg.devFixedOtp && code === cfg.devFixedOtp ? ('fixed' as const) : verifyTotp(decrypt(u.mfa_secret_enc), code, app.now());
    if (step === null) {
      await fail(u, 'auth.stepup_failed');
      return reply.code(401).send(GENERIC);
    }
    const fresh = step === 'fixed' || (await pool.query('select auth_accept_totp_step($1, $2) as ok', [u.id, step])).rows[0]?.ok;
    if (!fresh) return reply.code(401).send({ error: 'code_already_used' });
    await pool.query('select session_stepup($1, $2)', [a.sessionId, a.userId]);
    return { ok: true };
  });

  app.post('/auth/logout', { config: { access: 'user' } }, async (req, reply) => {
    const a = req.auth!;
    await pool.query('select session_revoke($1, $2)', [a.sessionId, a.userId]);
    if (a.tenantId) {
      await withTenant(pool, { tenantId: a.tenantId, userId: a.userId }, (tx) =>
        appendEvent(tx, { action: 'auth.logout', entityType: 'auth', entityId: a.userId }),
      );
    }
    reply.clearCookie('aos_session', { path: '/' });
    return { ok: true };
  });

  app.post('/auth/select-tenant', { config: { access: 'user' } }, async (req, reply) => {
    const { tenantId } = selectBody.parse(req.body);
    const a = req.auth!;
    const ok = (await pool.query('select session_select_tenant($1, $2, $3) as ok', [a.sessionId, a.userId, tenantId])).rows[0]?.ok;
    if (!ok) return reply.code(403).send({ error: 'not_a_member' });
    await withTenant(pool, { tenantId, userId: a.userId }, (tx) =>
      appendEvent(tx, { action: 'auth.tenant_selected', entityType: 'auth', entityId: a.userId }),
    );
    return { ok: true };
  });

  app.get('/me', { config: { access: 'user' } }, async (req: FastifyRequest) => {
    const a = req.auth!;
    const { email, memberships } = await withUser(pool, a.userId, async (tx) => ({
      email: (await tx.query('select email from users where id = $1', [a.userId])).rows[0]?.email as string,
      memberships: (
        await tx.query(
          'select m.tenant_id, t.name, m.role, m.grade from memberships m join tenants t on t.id = m.tenant_id where m.user_id = $1 and m.active order by t.name',
          [a.userId],
        )
      ).rows.map((r) => ({ tenantId: r.tenant_id as string, tenantName: r.name as string, role: r.role as string, grade: r.grade as number })),
    }));
    return {
      userId: a.userId,
      email,
      memberships,
      activeTenantId: a.tenantId,
      role: a.role,
      stepUpValid: a.stepUpAgeSec !== null && a.stepUpAgeSec < cfg.stepUpMinutes * 60,
    };
  });
}
