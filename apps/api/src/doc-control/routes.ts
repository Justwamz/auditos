import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can, GRADE } from '@auditos/authz';
import { withTenant } from '@auditos/db';
import { actorOf, assertCan, httpError, tenantCtx } from '../authz';
import { loadEngagement } from '../engagements/service';
import { registerDocControlGates } from './gates';
import { diffContent } from './versions';
import { editItemTx, lastEditor, loadItem, memberGrade, ITEM_COLUMNS, type ItemRow } from './service';

const uuid = z.string().uuid();
const MAX_CONTENT_BYTES = 200_000;

/** Kinds with their own endpoints and validation. They cannot be created or edited through the generic routes. */
const RESERVED_KINDS = ['evidence', 'checklist', 'trial_balance', 'trial_balance_prior', 'fs_mapping', 'adjustments', 'fs_note'];
const GENERIC_KINDS = ['acceptance', 'engagement_letter', 'materiality', 'risk_assessment', 'workpaper', 'eqr_review', 'addendum'] as const;

const createBody = z.object({
  kind: z.enum(GENERIC_KINDS),
  title: z.string().trim().min(1).max(300),
  content: z.record(z.string(), z.unknown()).default({}),
  addendumOf: uuid.optional(),
});
const patchBody = z
  .object({ title: z.string().trim().min(1).max(300).optional(), content: z.record(z.string(), z.unknown()).optional(), reason: z.string().trim().min(5).max(500).optional() })
  .refine((b) => b.title !== undefined || b.content !== undefined, 'nothing to change');
const signoffBody = z.object({ level: z.enum(['prepared', 'manager', 'partner']), expectedHash: z.string().regex(/^[0-9a-f]{64}$/) });
const reasonBody = z.object({ reason: z.string().max(500) });

const presentItem = (i: ItemRow) => ({
  id: i.id,
  engagementId: i.engagement_id,
  kind: i.kind,
  title: i.title,
  state: i.state,
  version: i.version,
  contentHash: i.content_hash,
  addendumOf: i.addendum_of,
  createdBy: i.created_by,
  createdAt: i.created_at,
  updatedAt: i.updated_at,
  deleted: i.deleted_at !== null,
});

export async function docControlRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;
  registerDocControlGates();

  const parseId = (raw: string): string => {
    const id = uuid.safeParse(raw);
    if (!id.success) throw httpError(404, 'not_found');
    return id.data;
  };

  app.post<{ Params: { id: string } }>('/engagements/:id/items', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = parseId(req.params.id);
    const body = createBody.parse(req.body);
    if (JSON.stringify(body.content).length > MAX_CONTENT_BYTES) throw httpError(413, 'content_too_large');
    const ctx = tenantCtx(req);
    const created = await withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      if (body.addendumOf) {
        if (!(await tx.query('select 1 from wp_items where id = $1 and engagement_id = $2', [body.addendumOf, engagementId])).rowCount) {
          throw httpError(422, 'addendum_target_invalid');
        }
        assertCan(req, 'item.edit', { assigned: true });
      } else {
        assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      }
      const r = await tx.query(
        'insert into wp_items (tenant_id, engagement_id, kind, title, content, addendum_of, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id, version, state, content_hash',
        [ctx.tenantId, engagementId, body.kind, body.title, JSON.stringify(body.content), body.addendumOf ?? null, ctx.userId],
      );
      return r.rows[0];
    });
    return reply.code(201).send({ id: created.id, version: created.version, state: created.state, contentHash: created.content_hash });
  });

  app.get<{ Params: { id: string }; Querystring: { kind?: string } }>('/engagements/:id/items', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = parseId(req.params.id);
    const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
    const rows = await withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, engagementId))) throw httpError(404, 'not_found');
      return (
        await tx.query(
          `select ${ITEM_COLUMNS} from wp_items where engagement_id = $1 and deleted_at is null and ($2::text is null or kind = $2) order by created_at`,
          [engagementId, kind],
        )
      ).rows as ItemRow[];
    });
    return { items: rows.map(presentItem) };
  });

  app.get<{ Params: { id: string } }>('/items/:id', { config: { access: 'tenant' } }, async (req) => {
    const id = parseId(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const item = await loadItem(tx, id);
      if (!item) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const signoffs = (
        await tx.query(
          `select s.id, s.level, s.user_id, u.email as user_email, s.version, s.content_hash, s.at, s.revoked_at, s.revoked_reason
             from signoffs s join users u on u.id = s.user_id where s.item_id = $1 order by s.at`,
          [id],
        )
      ).rows;
      const pending = (await tx.query("select id, requested_by, reason, created_at from deletion_requests where item_id = $1 and status = 'pending'", [id])).rows[0];
      return {
        ...presentItem(item),
        content: item.content,
        deletedReason: item.deleted_reason,
        signoffs: signoffs.map((s) => ({
          id: s.id, level: s.level, userId: s.user_id, userEmail: s.user_email, version: s.version, contentHash: s.content_hash, at: s.at,
          revoked: s.revoked_at !== null, revokedReason: s.revoked_reason,
        })),
        pendingDeletion: pending ? { id: pending.id, requestedBy: pending.requested_by, reason: pending.reason, createdAt: pending.created_at } : null,
      };
    });
  });

  app.patch<{ Params: { id: string } }>('/items/:id', { config: { access: 'tenant' } }, async (req) => {
    const id = parseId(req.params.id);
    const body = patchBody.parse(req.body);
    if (body.content !== undefined && JSON.stringify(body.content).length > MAX_CONTENT_BYTES) throw httpError(413, 'content_too_large');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const item = await loadItem(tx, id, true);
      if (!item) throw httpError(404, 'not_found');
      if (RESERVED_KINDS.includes(item.kind)) throw httpError(409, 'dedicated_endpoint_required');
      return editItemTx(req, tx, item, body);
    });
  });

  app.post<{ Params: { id: string } }>('/items/:id/signoff', { config: { access: 'tenant', stepUp: true } }, async (req) => {
    const id = parseId(req.params.id);
    const body = signoffBody.parse(req.body);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const item = await loadItem(tx, id);
      if (!item) throw httpError(404, 'not_found');
      const eng = await loadEngagement(tx, item.engagement_id);
      if (!eng) throw httpError(404, 'not_found');
      const editor = await lastEditor(tx, item);
      assertCan(req, `item.signoff.${body.level}`, {
        assigned: true,
        engagementState: eng.state,
        itemKind: item.kind,
        ...(editor.id ? { preparerId: editor.id, preparerGrade: editor.grade } : {}),
      });
      const r = await tx.query('select item_signoff($1, $2, $3) as state', [id, body.level, body.expectedHash]);
      return { state: r.rows[0].state as string };
    });
  });

  app.post<{ Params: { id: string } }>('/items/:id/delete-request', { config: { access: 'tenant' } }, async (req, reply) => {
    const id = parseId(req.params.id);
    const { reason } = reasonBody.parse(req.body);
    const result = await withTenant(pool, tenantCtx(req), async (tx) => {
      const item = await loadItem(tx, id);
      if (!item) throw httpError(404, 'not_found');
      const eng = await loadEngagement(tx, item.engagement_id);
      if (!eng) throw httpError(404, 'not_found');
      const actor = assertCan(req, 'item.delete.request', { assigned: true, itemState: item.state, engagementState: eng.state });
      const direct = (item.state === 'draft' || item.state === 'prepared') && (item.created_by === actor.userId || actor.role === 'manager' || actor.role === 'partner');
      if (direct) {
        await tx.query('select item_delete_direct($1, $2)', [id, reason]);
        return { deleted: true as const };
      }
      const r = await tx.query('select deletion_request_create($1, $2) as id', [id, reason]);
      return { deleted: false as const, requestId: r.rows[0].id as string };
    });
    return reply.code(result.deleted ? 200 : 202).send(result);
  });

  app.post<{ Params: { id: string } }>('/deletion-requests/:id/approve', { config: { access: 'tenant', stepUp: true } }, async (req) => {
    const id = parseId(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const r = (await tx.query('select item_id, requested_by from deletion_requests where id = $1', [id])).rows[0];
      if (!r) throw httpError(404, 'not_found');
      const item = await loadItem(tx, r.item_id as string);
      if (!item) throw httpError(404, 'not_found');
      const eng = await loadEngagement(tx, item.engagement_id);
      const requester = await memberGrade(tx, r.requested_by as string);
      assertCan(req, 'item.delete.approve', {
        assigned: true,
        requesterId: r.requested_by as string,
        requesterGrade: requester?.grade ?? GRADE.staff,
        ...(eng ? { engagementState: eng.state } : {}),
      });
      await tx.query('select deletion_request_approve($1)', [id]);
      return { deleted: true };
    });
  });

  app.get<{ Params: { id: string } }>('/items/:id/versions', { config: { access: 'tenant' } }, async (req) => {
    const id = parseId(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const item = await loadItem(tx, id);
      if (!item) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const rows = (
        await tx.query(
          `select v.version, v.title, v.content_hash, v.edited_by, u.email as edited_by_name, v.edited_at, v.reason
             from wp_item_versions v left join users u on u.id = v.edited_by where v.item_id = $1 order by v.version desc`,
          [id],
        )
      ).rows;
      return {
        versions: rows.map((v) => ({
          version: v.version as number, title: v.title as string, contentHash: v.content_hash as string, editedBy: v.edited_by as string | null,
          editedByName: v.edited_by_name as string | null, at: v.edited_at as string, reason: v.reason as string | null,
        })),
      };
    });
  });

  app.get<{ Params: { id: string; n: string } }>('/items/:id/versions/:n/changes', { config: { access: 'tenant' } }, async (req) => {
    const id = parseId(req.params.id);
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 1) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const item = await loadItem(tx, id);
      if (!item) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const rows = (await tx.query('select version, title, content from wp_item_versions where item_id = $1 and version in ($2, $2 - 1)', [id, n])).rows;
      const current = rows.find((r) => r.version === n);
      if (!current) throw httpError(404, 'not_found');
      const before = rows.find((r) => r.version === n - 1);
      const changes = diffContent(before?.content ?? undefined, current.content);
      if (before && before.title !== current.title) changes.unshift({ path: 'title', before: before.title, after: current.title });
      return { version: n, changes };
    });
  });

  app.post<{ Params: { id: string } }>('/items/:id/restore', { config: { access: 'tenant' } }, async (req) => {
    const id = parseId(req.params.id);
    const body = z.object({ version: z.number().int().min(1), reason: z.string().trim().min(5).max(500) }).parse(req.body);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const item = await loadItem(tx, id, true);
      if (!item) throw httpError(404, 'not_found');
      if (RESERVED_KINDS.includes(item.kind)) throw httpError(409, 'dedicated_endpoint_required');
      const old = (await tx.query('select title, content from wp_item_versions where item_id = $1 and version = $2', [id, body.version])).rows[0];
      if (!old) throw httpError(404, 'not_found');
      return editItemTx(req, tx, item, {
        title: old.title as string,
        content: old.content as Record<string, unknown>,
        reason: `Restored version ${body.version}: ${body.reason}`,
      });
    });
  });

  app.get<{ Params: { id: string } }>('/items/:id/history', { config: { access: 'tenant' } }, async (req) => {
    const id = parseId(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const item = await loadItem(tx, id);
      if (!item) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const versions = (await tx.query('select version, title, content, content_hash, edited_by, edited_at, reason from wp_item_versions where item_id = $1 order by version', [id])).rows;
      const signoffs = (await tx.query('select level, user_id, version, content_hash, at, revoked_at, revoked_reason from signoffs where item_id = $1 order by at', [id])).rows;
      const deletions = (await tx.query('select id, requested_by, approved_by, reason, status, created_at, decided_at from deletion_requests where item_id = $1 order by created_at', [id])).rows;
      const events = (
        await tx.query("select seq, at, actor_user_id, action, detail from audit_events where entity_type = 'wp_item' and entity_id = $1 order by seq", [id])
      ).rows;
      return {
        item: presentItem(item),
        versions: versions.map((v) => ({ version: v.version, title: v.title, content: v.content, contentHash: v.content_hash, editedBy: v.edited_by, editedAt: v.edited_at, reason: v.reason })),
        signoffs: signoffs.map((s) => ({ level: s.level, userId: s.user_id, version: s.version, contentHash: s.content_hash, at: s.at, revoked: s.revoked_at !== null, revokedReason: s.revoked_reason })),
        deletionRequests: deletions.map((d) => ({ id: d.id, requestedBy: d.requested_by, approvedBy: d.approved_by, reason: d.reason, status: d.status, createdAt: d.created_at, decidedAt: d.decided_at })),
        events: events.map((e) => ({ seq: Number(e.seq), at: e.at, actorUserId: e.actor_user_id, action: e.action, detail: e.detail })),
      };
    });
  });

  app.post<{ Params: { id: string } }>('/engagements/:id/unlock-requests', { config: { access: 'tenant', stepUp: true } }, async (req, reply) => {
    const engagementId = parseId(req.params.id);
    const { reason } = reasonBody.parse(req.body);
    const requestId = await withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, engagementId))) throw httpError(404, 'not_found');
      if (actorOf(req).role !== 'partner') throw httpError(403, 'forbidden');
      return (await tx.query('select unlock_request_create($1, $2) as id', [engagementId, reason])).rows[0].id as string;
    });
    return reply.code(201).send({ requestId });
  });

  app.post<{ Params: { id: string } }>('/unlock-requests/:id/approve', { config: { access: 'tenant', stepUp: true } }, async (req) => {
    const id = parseId(req.params.id);
    const me = actorOf(req);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const r = (await tx.query('select requested_by from unlock_requests where id = $1', [id])).rows[0];
      if (!r) throw httpError(404, 'not_found');
      const decision = can(
        { userId: r.requested_by as string, tenantId: me.tenantId, role: 'partner', active: true },
        'engagement.unlock',
        { assigned: true, approver: { userId: me.userId, role: me.role } },
      );
      if (!decision.allow) throw httpError(403, 'forbidden');
      await tx.query('select unlock_request_approve($1)', [id]);
      return { unlocked: true };
    });
  });
}
