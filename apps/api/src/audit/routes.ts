import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@auditos/db';
import { actorOf, httpError, tenantCtx } from '../authz';
import { describeEvent } from './sentences';

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  user: uuid.optional(),
  client: uuid.optional(),
  kind: z.enum(['all', 'views', 'changes', 'reveals', 'signins']).default('all'),
  from: day.optional(),
  to: day.optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Which actions each filter shows. */
const KIND_SQL: Record<string, string> = {
  all: 'true',
  views: "e.action like 'view.%' or e.action = 'evidence.downloaded' or e.action = 'export.created'",
  changes: "e.action like 'item.%' or e.action like 'prospect.%' or e.action like 'client.%' or e.action like 'calendar.%' or e.action like 'member.%' or e.entity_type in ('billing_settings', 'billing_rates', 'tax_rates', 'engagement_fees', 'signoffs', 'deletion_requests', 'unlock_requests', 'review_notes', 'engagement_members', 'engagements', 'clients')",
  reveals: "e.action like 'pii.%'",
  signins: "e.action like 'auth.%'",
};

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  /**
   * The audit trail in plain English. Partners and people with the admin permission see the whole firm;
   * a manager sees what happened on the engagements they are a member of; everyone else has no access.
   */
  app.get('/audit-trail', { config: { access: 'tenant' } }, async (req) => {
    const actor = actorOf(req);
    const wholeFirm = actor.role === 'partner' || actor.role === 'firm_admin' || actor.isAdmin === true;
    if (!wholeFirm && actor.role !== 'manager') throw httpError(403, 'forbidden');
    const q = query.parse(req.query);

    const where: string[] = [`(${KIND_SQL[q.kind]})`];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.user) add('e.actor_user_id = ?', q.user);
    if (q.client) add("e.detail ->> 'clientId' = ?", q.client);
    if (q.from) add('e.at >= ?::date', q.from);
    if (q.to) add("e.at < (?::date + interval '1 day')", q.to);
    if (q.before) add('e.seq < ?', q.before);
    if (!wholeFirm) {
      add("e.detail ->> 'engagementId' in (select engagement_id::text from engagement_members where user_id = ?)", actor.userId);
    }
    params.push(q.limit + 1);

    const rows = await withTenant(pool, tenantCtx(req), async (tx) =>
      (
        await tx.query(
          `select e.seq, e.at, e.action, e.entity_type, e.detail, e.actor_user_id, coalesce(u.full_name, u.email) as actor_name
             from audit_events e left join users u on u.id = e.actor_user_id
            where ${where.join(' and ')} order by e.seq desc limit $${params.length}`,
          params,
        )
      ).rows,
    );

    const page = rows.slice(0, q.limit);
    return {
      events: page.map((r) => {
        const detail = (r.detail ?? {}) as Record<string, unknown>;
        const str = (v: unknown) => (typeof v === 'string' ? v : null);
        return {
          seq: Number(r.seq),
          at: r.at as string,
          action: r.action as string,
          actorId: r.actor_user_id as string | null,
          actorName: r.actor_name as string | null,
          clientId: str(detail.clientId),
          clientName: str(detail.clientName),
          sentence: describeEvent({
            action: r.action, entityType: r.entity_type, actorName: r.actor_name, detail,
            clientName: str(detail.clientName), itemTitle: str(detail.itemTitle), itemKind: str(detail.itemKind),
          }),
        };
      }),
      next: rows.length > q.limit ? Number(page[page.length - 1]!.seq) : null,
    };
  });
}
