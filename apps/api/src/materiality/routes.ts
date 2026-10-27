import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@auditos/db';
import { BENCHMARKS, computeMateriality } from '@auditos/fs-engine';
import { assertCan, httpError, tenantCtx } from '../authz';
import { editItemTx, loadItem } from '../doc-control/service';
import { loadEngagement } from '../engagements/service';

const body = z.object({
  benchmark: z.enum(BENCHMARKS),
  amount: z.string().trim().max(30),
  percent: z.number(),
  performancePercent: z.number().optional(),
  trivialPercent: z.number().optional(),
  rationale: z.string().trim().min(10).max(2000),
});

export async function materialityRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  app.put<{ Params: { id: string } }>('/engagements/:id/materiality', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = z.string().uuid().safeParse(req.params.id);
    if (!engagementId.success) throw httpError(404, 'not_found');
    const input = body.parse(req.body);
    const ctx = tenantCtx(req);
    return withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId.data);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      let result;
      try {
        result = computeMateriality(input);
      } catch (e) {
        if (e instanceof RangeError) throw httpError(400, 'invalid_materiality');
        throw e;
      }
      const content = { ...input, ...result };
      const found = (await tx.query("select id from wp_items where engagement_id = $1 and kind = 'materiality' and deleted_at is null order by created_at limit 1 for update", [engagementId.data])).rows[0]?.id as string | undefined;
      const existing = found ? await loadItem(tx, found, true) : undefined;
      if (existing) {
        await editItemTx(req, tx, existing, { content, reason: 'Materiality recalculated' });
      } else {
        await tx.query("insert into wp_items (tenant_id, engagement_id, kind, title, content, created_by) values ($1, $2, 'materiality', 'Materiality', $3, $4)", [
          ctx.tenantId, engagementId.data, JSON.stringify(content), ctx.userId,
        ]);
      }
      return result;
    });
  });
}
