import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GRADE, type Role } from '@auditos/authz';
import { withTenant } from '@auditos/db';
import { assertCan, httpError, tenantCtx } from '../authz';
import { signToken, verifyToken } from '../security/crypto';
import { hashPassword } from '../security/password';
import { isGenericMailbox, isPersonName } from '../people/names';

const ROLES = ['firm_admin', 'partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'] as const;
const INVITE_MS = 72 * 3_600_000;

const fullName = z.string().trim().max(120).refine(isPersonName, 'enter the full name of the person');
const personalEmail = z.string().email().max(254).refine((e) => !isGenericMailbox(e), { message: 'generic_mailbox' });
const inviteBody = z.object({ email: personalEmail, fullName, role: z.enum(ROLES), isAdmin: z.boolean().optional() });
const patchBody = z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional(), isAdmin: z.boolean().optional() }).refine((b) => b.role !== undefined || b.active !== undefined || b.isAdmin !== undefined, 'nothing to change');
const acceptBody = z.object({ token: z.string().min(1).max(2048), password: z.string().min(12).max(512) });
const platformBody = z.object({ name: z.string().min(2).max(200), adminEmail: personalEmail, adminFullName: fullName });

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  const fingerprint = async (userId: string): Promise<string | null> =>
    ((await pool.query('select auth_user_fingerprint($1) as f', [userId])).rows[0]?.f as string | null) ?? null;

  const needsInvite = async (userId: string): Promise<boolean> =>
    (await pool.query('select auth_needs_invite($1) as n', [userId])).rows[0]?.n === true;

  /** Only accounts that have never had a password get a token. Existing accounts are added to the firm without one. */
  const inviteTokenFor = async (userId: string): Promise<string | null> =>
    (await needsInvite(userId)) ? signToken({ uid: userId, purpose: 'invite', fp: await fingerprint(userId) }, app.now() + INVITE_MS) : null;

  app.get('/admin/users', { config: { access: 'tenant' } }, async (req) => {
    assertCan(req, 'tenant.admin');
    const rows = await withTenant(pool, tenantCtx(req), async (tx) =>
      (
        await tx.query(
          `select u.id, u.email, u.full_name, u.mfa_enabled, u.active as user_active, m.role, m.grade, m.active, (m.is_admin or m.role = 'firm_admin') as is_admin
             from memberships m join users u on u.id = m.user_id order by u.email`,
        )
      ).rows,
    );
    return {
      users: rows.map((r) => ({ id: r.id, fullName: r.full_name as string | null, email: r.email, isAdmin: r.is_admin === true, role: r.role, grade: r.grade, active: r.active && r.user_active, mfaEnabled: r.mfa_enabled })),
    };
  });

  app.post('/admin/users', { config: { access: 'tenant' } }, async (req, reply) => {
    assertCan(req, 'tenant.admin');
    const body = inviteBody.parse(req.body);
    const userId = await withTenant(pool, tenantCtx(req), async (tx) =>
      (await tx.query('select admin_invite_user($1, $2, $3, $4, $5) as id', [body.email, body.role, GRADE[body.role as Role], body.fullName, body.isAdmin ?? false])).rows[0].id as string,
    );
    return reply.code(201).send({ userId, inviteToken: await inviteTokenFor(userId) });
  });

  app.patch<{ Params: { id: string } }>('/admin/users/:id', { config: { access: 'tenant' } }, async (req, reply) => {
    const actor = assertCan(req, 'tenant.admin');
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const body = patchBody.parse(req.body);
    if (id.data === actor.userId && (body.active === false || (body.role !== undefined && body.role !== 'firm_admin'))) {
      throw httpError(409, 'cannot_modify_self');
    }
    const updated = await withTenant(pool, tenantCtx(req), async (tx) => {
      if (body.role !== undefined || body.active !== undefined) {
        await tx.query('select admin_update_member($1, $2, $3, $4)', [
          id.data,
          body.role ?? null,
          body.role === undefined ? null : GRADE[body.role as Role],
          body.active ?? null,
        ]);
      }
      if (body.isAdmin !== undefined) await tx.query('select admin_set_admin($1, $2)', [id.data, body.isAdmin]);
      return true;
    });
    if (!updated) throw httpError(404, 'not_found');
    return reply.send({ ok: true });
  });

  app.post('/auth/accept-invite', { config: { access: 'public', rateLimit: { max: app.cfg.loginRateLimit * 2, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = acceptBody.parse(req.body);
    const t = verifyToken<{ uid: string; purpose: string; fp: string | null }>(body.token, app.now());
    if (!t || t.purpose !== 'invite' || typeof t.uid !== 'string') return reply.code(401).send({ error: 'invalid_invite' });
    if ((await fingerprint(t.uid)) !== t.fp || !(await needsInvite(t.uid))) return reply.code(401).send({ error: 'invalid_invite' });
    await pool.query('select auth_set_password($1, $2)', [t.uid, await hashPassword(body.password)]);
    return { ok: true };
  });

  app.post('/platform/tenants', { config: { access: 'public', csrf: false } }, async (req, reply) => {
    const expected = process.env.PLATFORM_ADMIN_TOKEN;
    const given = req.headers['x-platform-token'];
    const ok =
      !!expected && typeof given === 'string' && Buffer.byteLength(given) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) return reply.code(401).send({ error: 'unauthorized' });
    const body = platformBody.parse(req.body);
    const r = (await pool.query('select * from platform_create_tenant($1, $2, $3)', [body.name, body.adminEmail, body.adminFullName])).rows[0];
    return reply.code(201).send({ tenantId: r.tenant_id, userId: r.user_id, inviteToken: await inviteTokenFor(r.user_id) });
  });
}
