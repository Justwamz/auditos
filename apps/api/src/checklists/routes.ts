import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { generateChecklists, loadTemplates, type Framework, type Sector } from '@auditos/standards';
import { withTenant } from '@auditos/db';
import { assertCan, httpError, tenantCtx } from '../authz';
import { editItemTx, loadItem } from '../doc-control/service';
import { registerGate } from '../engagements/gates';
import { loadEngagement } from '../engagements/service';

const uuid = z.string().uuid();

interface ChecklistItemState {
  id: string;
  ref: string;
  question: string;
  mandatory: boolean;
  standardRefs: string[];
  response: 'yes' | 'no' | 'na' | null;
  rationale: string;
  evidenceIds: string[];
  /** Last year's answer for the same client: a suggestion only, never counted as answered. */
  prior: { response: 'yes' | 'no' | 'na'; rationale: string } | null;
}
interface ChecklistContent {
  templateId: string;
  templateVersion: number;
  phase: string;
  items: ChecklistItemState[];
}

const answerBody = z.object({
  response: z.enum(['yes', 'no', 'na']),
  rationale: z.string().max(2000).default(''),
  evidenceIds: z.array(uuid).max(20).default([]),
  reason: z.string().trim().min(5).max(500).optional(),
});

export async function checklistRows(tx: PoolClient, engagementId: string): Promise<{ id: string; title: string; content: ChecklistContent }[]> {
  return (
    await tx.query("select id, title, content from wp_items where engagement_id = $1 and kind = 'checklist' and deleted_at is null and content ? 'templateId' order by created_at", [engagementId])
  ).rows;
}

/** Answers from the previous engagement for the same client, by template and item id. Empty for a first engagement. */
async function priorAnswers(tx: PoolClient, engagementId: string): Promise<Map<string, Map<string, { response: 'yes' | 'no' | 'na'; rationale: string }>>> {
  const rows = (await tx.query('select kind, content from engagement_prior_snapshot($1)', [engagementId])).rows as { kind: string; content: ChecklistContent }[];
  const out = new Map<string, Map<string, { response: 'yes' | 'no' | 'na'; rationale: string }>>();
  for (const r of rows) {
    if (r.kind !== 'checklist' || !r.content.templateId) continue;
    const answers = new Map<string, { response: 'yes' | 'no' | 'na'; rationale: string }>();
    for (const it of r.content.items) if (it.response) answers.set(it.id, { response: it.response, rationale: it.rationale });
    out.set(r.content.templateId, answers);
  }
  return out;
}

export function computeCompleteness(rows: { id: string; title: string; content: ChecklistContent }[]) {
  const mandatoryOpen: { checklistId: string; checklistTitle: string; itemId: string; ref: string; question: string }[] = [];
  let total = 0;
  let answered = 0;
  for (const r of rows) {
    for (const it of r.content.items) {
      total += 1;
      if (it.response !== null) answered += 1;
      else if (it.mandatory) mandatoryOpen.push({ checklistId: r.id, checklistTitle: r.title, itemId: it.id, ref: it.ref, question: it.question });
    }
  }
  return { mandatoryOpen, total, answered, percent: total === 0 ? 0 : Math.round((answered / total) * 100) };
}

export function registerChecklistGates(): void {
  registerGate('fieldwork', 'completion', {
    gate: 'mandatoryChecklistComplete',
    message: 'Checklists must be generated and every mandatory item answered',
    run: async (tx, id) => {
      const rows = await checklistRows(tx, id);
      return rows.length > 0 && computeCompleteness(rows).mandatoryOpen.length === 0;
    },
  });
}

export async function checklistRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;
  registerChecklistGates();
  const templates = loadTemplates();

  app.post<{ Params: { id: string } }>('/engagements/:id/checklists/generate', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = uuid.safeParse(req.params.id);
    if (!engagementId.success) throw httpError(404, 'not_found');
    const ctx = tenantCtx(req);
    const result = await withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId.data);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      const { checklists, notices } = generateChecklists(
        { sector: eng.sector as Sector, framework: eng.framework as Framework, riskFlags: eng.risk_profile.riskFlags ?? [] },
        templates,
      );
      const existing = new Set((await checklistRows(tx, engagementId.data)).map((r) => r.content.templateId));
      const prior = await priorAnswers(tx, engagementId.data);
      let created = 0;
      let skipped = 0;
      for (const c of checklists) {
        if (existing.has(c.templateId)) {
          skipped += 1;
          continue;
        }
        const content: ChecklistContent = {
          templateId: c.templateId,
          templateVersion: c.templateVersion,
          phase: c.phase,
          items: c.items.map((i) => ({
            id: i.id, ref: i.ref, question: i.question, mandatory: i.mandatory, standardRefs: i.standardRefs,
            response: null, rationale: '', evidenceIds: [], prior: prior.get(c.templateId)?.get(i.id) ?? null,
          })),
        };
        await tx.query("insert into wp_items (tenant_id, engagement_id, kind, title, content, created_by) values ($1, $2, 'checklist', $3, $4, $5)", [
          ctx.tenantId, engagementId.data, c.title, JSON.stringify(content), ctx.userId,
        ]);
        created += 1;
      }
      return { created, skipped, notices };
    });
    return reply.code(201).send(result);
  });

  app.patch<{ Params: { id: string; itemId: string } }>('/checklists/:id/items/:itemId', { config: { access: 'tenant' } }, async (req) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success || req.params.itemId.length > 40) throw httpError(404, 'not_found');
    const body = answerBody.parse(req.body);
    if (body.response !== 'yes' && body.rationale.trim().length < 5) throw httpError(400, 'rationale_required');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const item = await loadItem(tx, id.data, true);
      if (!item || item.kind !== 'checklist') throw httpError(404, 'not_found');
      const content = item.content as unknown as ChecklistContent;
      const idx = content.items.findIndex((i) => i.id === req.params.itemId);
      if (idx < 0) throw httpError(404, 'checklist_item_not_found');
      const evidenceIds = [...new Set(body.evidenceIds)];
      if (evidenceIds.length > 0) {
        const ok = await tx.query(
          "select count(*)::int as n from wp_items where id = any($1::uuid[]) and engagement_id = $2 and kind = 'evidence' and deleted_at is null",
          [evidenceIds, item.engagement_id],
        );
        if (ok.rows[0].n !== evidenceIds.length) throw httpError(422, 'invalid_evidence');
      }
      const items = content.items.map((i, n) => (n === idx ? { ...i, response: body.response, rationale: body.rationale.trim(), evidenceIds } : i));
      return editItemTx(req, tx, item, { content: { ...content, items }, ...(body.reason ? { reason: body.reason } : {}) });
    });
  });

  app.post<{ Params: { id: string; itemId: string } }>('/checklists/:id/items/:itemId/confirm-prior', { config: { access: 'tenant' } }, async (req) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success || req.params.itemId.length > 40) throw httpError(404, 'not_found');
    const body = z.object({ reason: z.string().trim().min(5).max(500).optional() }).parse(req.body ?? {});
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const item = await loadItem(tx, id.data, true);
      if (!item || item.kind !== 'checklist') throw httpError(404, 'not_found');
      const content = item.content as unknown as ChecklistContent;
      const idx = content.items.findIndex((i) => i.id === req.params.itemId);
      if (idx < 0) throw httpError(404, 'checklist_item_not_found');
      const prior = content.items[idx]!.prior;
      if (!prior) throw httpError(409, 'no_prior_answer');
      const items = content.items.map((i, n) => (n === idx ? { ...i, response: prior.response, rationale: prior.rationale, evidenceIds: [] } : i));
      return editItemTx(req, tx, item, { content: { ...content, items }, ...(body.reason ? { reason: body.reason } : {}) });
    });
  });

  app.get<{ Params: { id: string } }>('/engagements/:id/completeness', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = uuid.safeParse(req.params.id);
    if (!engagementId.success) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, engagementId.data))) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      return computeCompleteness(await checklistRows(tx, engagementId.data));
    });
  });
}
