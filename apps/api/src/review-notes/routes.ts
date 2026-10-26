import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@auditos/db';
import { assertCan, httpError, tenantCtx } from '../authz';
import { loadItem } from '../doc-control/service';
import { registerGate } from '../engagements/gates';
import { loadEngagement } from '../engagements/service';

const uuid = z.string().uuid();
const raiseBody = z.object({ text: z.string().trim().min(1).max(2000) });
const clearBody = z.object({ response: z.string().trim().min(1).max(2000) });
const acceptBody = z.object({ justification: z.string().trim().min(1).max(2000) });

export function registerReviewNoteGates(): void {
  const gate = {
    gate: 'reviewNotesCleared',
    message: 'All review notes must be cleared or accepted',
    run: async (tx: import('pg').PoolClient, id: string) => (await tx.query('select open_review_notes($1) as n', [id])).rows[0].n === 0,
  };
  registerGate('fieldwork', 'completion', gate);
  registerGate('review', 'partner_approved', gate);
}

const present = (r: Record<string, unknown>) => ({
  id: r.id,
  itemId: r.item_id,
  raisedBy: r.raised_by,
  text: r.text,
  status: r.status,
  response: r.response,
  resolvedBy: r.resolved_by,
  resolvedAt: r.resolved_at,
  createdAt: r.created_at,
});
const COLUMNS = 'id, item_id, raised_by, text, status, response, resolved_by, resolved_at, created_at';

export async function reviewNoteRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;
  registerReviewNoteGates();

  const parse = (raw: string) => {
    const id = uuid.safeParse(raw);
    if (!id.success) throw httpError(404, 'not_found');
    return id.data;
  };

  app.post<{ Params: { id: string } }>('/items/:id/review-notes', { config: { access: 'tenant' } }, async (req, reply) => {
    const id = parse(req.params.id);
    const { text } = raiseBody.parse(req.body);
    const noteId = await withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadItem(tx, id))) throw httpError(404, 'not_found');
      return (await tx.query('select review_note_create($1, $2) as id', [id, text])).rows[0].id as string;
    });
    return reply.code(201).send({ id: noteId });
  });

  app.get<{ Params: { id: string } }>('/items/:id/review-notes', { config: { access: 'tenant' } }, async (req) => {
    const id = parse(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadItem(tx, id))) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const rows = (await tx.query(`select ${COLUMNS} from review_notes where item_id = $1 order by created_at`, [id])).rows;
      return { notes: rows.map(present) };
    });
  });

  app.get<{ Params: { id: string }; Querystring: { status?: string } }>('/engagements/:id/review-notes', { config: { access: 'tenant' } }, async (req) => {
    const id = parse(req.params.id);
    const status = ['open', 'cleared', 'accepted'].includes(String(req.query.status)) ? String(req.query.status) : null;
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, id))) throw httpError(404, 'not_found');
      const rows = (
        await tx.query(`select ${COLUMNS} from review_notes where engagement_id = $1 and ($2::text is null or status = $2) order by created_at`, [id, status])
      ).rows;
      return { notes: rows.map(present) };
    });
  });

  for (const [action, body, field] of [
    ['clear', clearBody, 'response'],
    ['accept', acceptBody, 'justification'],
  ] as const) {
    app.post<{ Params: { id: string } }>(`/review-notes/:id/${action}`, { config: { access: 'tenant' } }, async (req) => {
      const id = parse(req.params.id);
      const parsed = body.parse(req.body) as Record<string, string>;
      await withTenant(pool, tenantCtx(req), async (tx) => {
        if (!(await tx.query('select 1 from review_notes where id = $1', [id])).rowCount) throw httpError(404, 'not_found');
        await tx.query('select review_note_resolve($1, $2, $3)', [id, action === 'clear' ? 'cleared' : 'accepted', parsed[field]]);
      });
      return { status: action === 'clear' ? 'cleared' : 'accepted' };
    });
  }
}
