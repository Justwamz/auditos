import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GRADE, type Role } from '@auditos/authz';
import { withTenant } from '@auditos/db';
import { assertCan, httpError, tenantCtx } from '../authz';
import { signToken, verifyToken } from '../security/crypto';
import { hashPassword } from '../security/password';

const ROLES = ['firm_admin', 'partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'] as const;
const INVITE_MS = 72 * 3_600_000;

const inviteBody = z.object({ email: z.string().email().max(254), role: z.enum(ROLES) });
const patchBody = z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional() }).refine((b) => b.role !== undefined || b.active !== undefined, 'nothing to change');
const acceptBody = z.object({ token: z.string().min(1).max(2048), password: z.string().min(12).max(512) });
const platformBody = z.object({ name: z.string().min(2).max(200), adminEmail: z.string().email().max(254) });

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  const fingerprint = async (userId: string): Promise<string | null> =>
    ((await pool.query('select auth_user_fingerprint($1) as f', [userId])).rows[0]?.f as string | null) ?? null;

  const inviteTokenFor = async (userId: string): Promise<string> =>
    signToken({ uid: userId, purpose: 'invite', fp: await fingerprint(userId) }, app.now() + INVITE_MS);

  app.get('/admin/users', { config: { access: 'tenant' } }, async (req) => {
    assertCan(req, 'tenant.admin');
    const rows = await withTenant(pool, tenantCtx(req), async (tx) =>
      (
        await tx.query(
          `select u.id, u.email, u.mfa_enabled, u.active as user_active, m.role, m.grade, m.active
             from memberships m join users u on u.id = m.user_id order by u.email`,
        )
      ).rows,
    );
    return {
      users: rows.map((r) => ({ id: r.id, email: r.email, role: r.role, grade: r.grade, active: r.active && r.user_active, mfaEnabled: r.mfa_enabled })),
    };
  });

  app.post('/admin/users', { config: { access: 'tenant' } }, async (req, reply) => {
    assertCan(req, 'tenant.admin');
    const body = inviteBody.parse(req.body);
    const userId = await withTenant(pool, tenantCtx(req), async (tx) =>
      (await tx.query('select admin_invite_user($1, $2, $3) as id', [body.email, body.role, GRADE[body.role as Role]])).rows[0].id as string,
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
      const sets: string[] = [];
      const args: unknown[] = [id.data];
      if (body.role !== undefined) {
        args.push(body.role, GRADE[body.role as Role]);
        sets.push(`role = $${args.length - 1}`, `grade = $${args.length}`);
      }
      if (body.active !== undefined) {
        args.push(body.active);
        sets.push(`active = $${args.length}`);
      }
      const r = await tx.query(`update memberships set ${sets.join(', ')} where user_id = $1`, args);
      if (r.rowCount === 0) return false;
      if (body.active === false) await tx.query('select session_revoke_tenant($1)', [id.data]);
      return true;
    });
    if (!updated) throw httpError(404, 'not_found');
    return reply.send({ ok: true });
  });

  app.post('/auth/accept-invite', { config: { access: 'public', rateLimit: { max: app.cfg.loginRateLimit * 2, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = acceptBody.parse(req.body);
    const t = verifyToken<{ uid: string; purpose: string; fp: string | null }>(body.token, app.now());
    if (!t || t.purpose !== 'invite' || typeof t.uid !== 'string') return reply.code(401).send({ error: 'invalid_invite' });
    if ((await fingerprint(t.uid)) !== t.fp) return reply.code(401).send({ error: 'invalid_invite' });
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
    const r = (await pool.query('select * from platform_create_tenant($1, $2)', [body.name, body.adminEmail])).rows[0];
    return reply.code(201).send({ tenantId: r.tenant_id, userId: r.user_id, inviteToken: await inviteTokenFor(r.user_id) });
  });
}
