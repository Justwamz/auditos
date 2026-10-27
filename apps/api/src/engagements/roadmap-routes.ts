import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@auditos/db';
import { assertCan, httpError, tenantCtx } from '../authz';
import { checklistRows, computeCompleteness } from '../checklists/routes';
import { buildRoadmap, type RoadmapFacts } from './roadmap';
import { loadEngagement } from './service';

export async function roadmapRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  app.get<{ Params: { id: string } }>('/engagements/:id/roadmap', { config: { access: 'tenant' } }, async (req) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const eng = await loadEngagement(tx, id.data);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const rows = await checklistRows(tx, id.data);
      const checklists: RoadmapFacts['checklists'] = {};
      for (const r of rows) {
        const c = computeCompleteness([r]);
        checklists[r.content.templateId] = { total: c.total, answered: c.answered, mandatoryOpen: c.mandatoryOpen.length };
      }
      const kinds = new Set(
        (await tx.query('select distinct kind from wp_items where engagement_id = $1 and deleted_at is null', [id.data])).rows.map((r) => r.kind as string),
      );
      const openNotes = (await tx.query("select count(*)::int as n from review_notes where engagement_id = $1 and status = 'open'", [id.data])).rows[0].n as number;
      const awaiting = (
        await tx.query("select count(*)::int as n from wp_items where engagement_id = $1 and deleted_at is null and kind <> 'evidence' and state in ('prepared', 'manager_reviewed')", [id.data])
      ).rows[0].n as number;
      return buildRoadmap({
        state: eng.state,
        checklists,
        hasEngagementLetter: kinds.has('engagement_letter'),
        hasMateriality: kinds.has('materiality'),
        hasRiskAssessment: kinds.has('risk_assessment'),
        hasMappedTb: kinds.has('trial_balance') && kinds.has('fs_mapping'),
        openReviewNotes: openNotes,
        awaitingSignoff: awaiting,
      });
    });
  });
}
