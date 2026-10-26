import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@auditos/db';
import { httpError, tenantCtx } from '../authz';
import { loadEngagement } from '../engagements/service';

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  /** Active people in the caller's own firm. Identity and role only. */
  app.get('/people', { config: { access: 'tenant' } }, async (req) => {
    const rows = await withTenant(pool, tenantCtx(req), async (tx) =>
      (
        await tx.query(
          `select u.id, u.email, m.role, m.grade from memberships m join users u on u.id = m.user_id
            where m.active and u.active and m.role <> 'firm_admin' order by m.role, u.email`,
        )
      ).rows,
    );
    return { people: rows.map((r) => ({ id: r.id, email: r.email, role: r.role, grade: r.grade })) };
  });

  app.get<{ Params: { id: string } }>('/engagements/:id/members', { config: { access: 'tenant' } }, async (req) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, id.data))) throw httpError(404, 'not_found');
      const rows = (
        await tx.query(
          `select em.user_id, u.email, m.role from engagement_members em
             join users u on u.id = em.user_id
             join memberships m on m.user_id = em.user_id and m.tenant_id = em.tenant_id
            where em.engagement_id = $1 order by m.role, u.email`,
          [id.data],
        )
      ).rows;
      return { members: rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role })) };
    });
  });

  app.get<{ Params: { id: string } }>('/engagements/:id/unlock-requests', { config: { access: 'tenant' } }, async (req) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, id.data))) throw httpError(404, 'not_found');
      const rows = (
        await tx.query(
          `select r.id, r.requested_by, ru.email as requested_by_email, r.reason, r.status, r.created_at, r.decided_at
             from unlock_requests r join users ru on ru.id = r.requested_by where r.engagement_id = $1 order by r.created_at desc`,
          [id.data],
        )
      ).rows;
      return {
        requests: rows.map((r) => ({
          id: r.id, requestedBy: r.requested_by, requestedByEmail: r.requested_by_email, reason: r.reason, status: r.status,
          createdAt: r.created_at, decidedAt: r.decided_at,
        })),
      };
    });
  });

  app.get('/independence', { config: { access: 'tenant' } }, async (req) => {
    const ctx = tenantCtx(req);
    const rows = await withTenant(pool, ctx, async (tx) =>
      (
        await tx.query(
          'select id, engagement_id, declared_at, expires_at from independence_declarations where user_id = $1 order by declared_at desc',
          [ctx.userId],
        )
      ).rows,
    );
    return { declarations: rows.map((r) => ({ id: r.id, engagementId: r.engagement_id, declaredAt: r.declared_at, expiresAt: r.expires_at })) };
  });
}
