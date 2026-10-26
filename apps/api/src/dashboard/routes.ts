import type { FastifyInstance } from 'fastify';
import { withTenant } from '@auditos/db';
import { tenantCtx, actorOf } from '../authz';
import { listEngagements } from '../engagements/service';

const QUEUE_SQL = `
  select i.id, i.title, i.kind, i.engagement_id, c.name as client_name
    from wp_items i
    join engagements e on e.id = i.engagement_id
    join clients c on c.id = e.client_id
   where i.deleted_at is null and e.state <> 'locked' and i.state = $1
     and not exists (select 1 from wp_item_versions v where v.item_id = i.id and v.version = i.version and v.edited_by = $2)
   order by i.updated_at`;

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  app.get('/dashboard', { config: { access: 'tenant' } }, async (req) => {
    const ctx = tenantCtx(req);
    const role = actorOf(req).role;
    return withTenant(pool, ctx, async (tx) => {
      const engagements = await listEngagements(tx);
      const queue: { state: string; level: 'manager' | 'partner' } | null =
        role === 'manager' ? { state: 'prepared', level: 'manager' } : role === 'partner' || role === 'eqr' ? { state: 'manager_reviewed', level: 'partner' } : null;
      const awaiting = queue ? (await tx.query(QUEUE_SQL, [queue.state, ctx.userId])).rows : [];
      const drafts = (
        await tx.query(
          `select i.id, i.title, i.kind, i.engagement_id, c.name as client_name
             from wp_items i join engagements e on e.id = i.engagement_id join clients c on c.id = e.client_id
            where i.deleted_at is null and i.state = 'draft' and i.created_by = $1 and e.state <> 'locked' order by i.updated_at desc`,
          [ctx.userId],
        )
      ).rows;
      const openNotes = (await tx.query("select count(*)::int as n from review_notes where status = 'open'")).rows[0].n as number;
      const shape = (r: Record<string, unknown>) => ({ id: r.id, title: r.title, kind: r.kind, engagementId: r.engagement_id, clientName: r.client_name });
      return {
        engagements: engagements.map((e) => ({
          id: e.id, clientName: e.client_name, sector: e.sector, periodStart: e.period_start, periodEnd: e.period_end, state: e.state,
        })),
        awaitingReview: awaiting.map((r) => ({ ...shape(r), level: queue?.level })),
        myDrafts: drafts.map(shape),
        openNotes,
      };
    });
  });
}
