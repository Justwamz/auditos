import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@auditos/db';
import { actorOf, assertCan, httpError, tenantCtx } from '../authz';

const uuid = z.string().uuid();
const reason = z.string().trim().min(5).max(500);

export async function handoverRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  /** A client's account manager changes. Partners and people with the administrator permission only, always with a reason. */
  app.post<{ Params: { id: string } }>('/clients/:id/account-manager', { config: { access: 'tenant' } }, async (req) => {
    const actor = actorOf(req);
    if (actor.role !== 'partner' && !actor.isAdmin && actor.role !== 'firm_admin') throw httpError(403, 'forbidden');
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = z.object({ userId: uuid, reason }).parse(req.body);
    await withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await tx.query('select client_manager_valid($1) as ok', [b.userId])).rows[0].ok) throw httpError(400, 'invalid_account_manager');
      await tx.query('select client_reassign_manager($1, $2, $3)', [id.data, b.userId, b.reason]);
    });
    return { ok: true };
  });

  /** What someone holds, so it can be handed over before they leave. */
  app.get<{ Params: { id: string } }>('/admin/users/:id/handover', { config: { access: 'tenant' } }, async (req) => {
    assertCan(req, 'tenant.admin');
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const rows = await withTenant(pool, tenantCtx(req), async (tx) => (await tx.query('select kind, id, name from member_responsibilities($1)', [id.data])).rows as { kind: string; id: string; name: string }[]);
    const pick = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => ({ id: r.id, name: r.name }));
    return { clients: pick('client'), prospects: pick('prospect') };
  });

  /** Everything one person holds moves to another, with one reason. */
  app.post<{ Params: { id: string } }>('/admin/users/:id/handover', { config: { access: 'tenant' } }, async (req) => {
    assertCan(req, 'tenant.admin');
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = z.object({ toUserId: uuid, reason }).parse(req.body);
    const r = await withTenant(pool, tenantCtx(req), async (tx) => (await tx.query('select clients, prospects from member_handover($1, $2, $3)', [id.data, b.toUserId, b.reason])).rows[0] as { clients: number; prospects: number });
    return { clients: r.clients, prospects: r.prospects };
  });
}
