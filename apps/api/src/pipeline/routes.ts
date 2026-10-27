import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { formatMoney, parseMoney } from '@auditos/fs-engine';
import { withTenant } from '@auditos/db';
import { actorOf, assertCan, httpError, tenantCtx } from '../authz';

const uuid = z.string().uuid();
const SECTORS = ['trading', 'consultancy', 'rental', 'farming', 'pension', 'investment'] as const;
const STAGES = ['lead', 'proposal', 'loe_sent', 'won', 'lost'] as const;
const WORKERS = ['partner', 'manager', 'senior', 'staff'];

const fee = z
  .string()
  .trim()
  .max(20)
  .transform((s, ctx) => {
    try {
      const cents = parseMoney(s);
      if (cents < 0n) throw new Error('negative');
      return cents;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'enter an amount in KES, for example 450000.00' });
      return z.NEVER;
    }
  });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date');
const text = (max: number) => z.string().trim().max(max);

const createBody = z.object({
  name: z.string().trim().min(2).max(200),
  sector: z.enum(SECTORS).optional(),
  contactName: text(120).optional(),
  source: text(120).optional(),
  ownerId: uuid.optional(),
  expectedFee: fee.optional(),
  expectedStart: date.optional(),
  notes: text(4000).optional(),
});
const patchBody = createBody.omit({ ownerId: true }).partial();
const stageBody = z.object({ stage: z.enum(STAGES), reason: text(500).optional() });
const ownerBody = z.object({ userId: uuid, reason: text(500).default('') });
const convertBody = z.object({
  accountManagerId: uuid.optional(),
  legalForm: z.string().trim().min(1).max(60),
  yearEndMonth: z.number().int().min(1).max(12),
  framework: z.enum(['IFRS_SME', 'FULL_IFRS']).default('IFRS_SME'),
  sector: z.enum(SECTORS).optional(),
});

interface Row {
  id: string; name: string; sector: string | null; contact_name: string | null; source: string | null; owner_id: string; owner_name: string;
  stage: string; expected_fee_cents: string | null; expected_start: string | null; notes: string | null; lost_reason: string | null;
  client_id: string | null; created_at: string;
}

const SELECT = `select p.id, p.name, p.sector, p.contact_name, p.source, p.owner_id, coalesce(u.full_name, u.email) as owner_name, p.stage,
       p.expected_fee_cents::text, to_char(p.expected_start, 'YYYY-MM-DD') as expected_start, p.notes, p.lost_reason, p.client_id, p.created_at
  from prospects p join users u on u.id = p.owner_id`;

const present = (r: Row) => ({
  id: r.id, name: r.name, sector: r.sector, contactName: r.contact_name, source: r.source, ownerId: r.owner_id, ownerName: r.owner_name,
  stage: r.stage, expectedFee: r.expected_fee_cents === null ? null : formatMoney(BigInt(r.expected_fee_cents)), expectedStart: r.expected_start,
  notes: r.notes, lostReason: r.lost_reason, clientId: r.client_id, createdAt: r.created_at,
});

/** Totals for the board: how many and how much in each stage, and what each person is carrying. */
function summarise(rows: Row[]) {
  const byStage: Record<string, { count: number; cents: bigint }> = Object.fromEntries(STAGES.map((s) => [s, { count: 0, cents: 0n }]));
  const byOwner = new Map<string, { ownerId: string; ownerName: string; count: number; cents: bigint }>();
  for (const r of rows) {
    const cents = r.expected_fee_cents === null ? 0n : BigInt(r.expected_fee_cents);
    const s = byStage[r.stage]!;
    s.count += 1;
    s.cents += cents;
    if (r.stage !== 'won' && r.stage !== 'lost') {
      const o = byOwner.get(r.owner_id) ?? { ownerId: r.owner_id, ownerName: r.owner_name, count: 0, cents: 0n };
      o.count += 1;
      o.cents += cents;
      byOwner.set(r.owner_id, o);
    }
  }
  return {
    byStage: Object.fromEntries(Object.entries(byStage).map(([k, v]) => [k, { count: v.count, value: formatMoney(v.cents) }])),
    byOwner: [...byOwner.values()].map((o) => ({ ownerId: o.ownerId, ownerName: o.ownerName, count: o.count, value: formatMoney(o.cents) })),
  };
}

export async function pipelineRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  /** Partners, managers, seniors and staff work the pipeline; administrators, quality officers and reviewers do not. */
  const requireWorker = (req: Parameters<typeof actorOf>[0]) => {
    const a = actorOf(req);
    if (!WORKERS.includes(a.role)) throw httpError(403, 'forbidden');
    return a;
  };

  app.get('/prospects', { config: { access: 'tenant' } }, async (req) => {
    requireWorker(req);
    const rows = await withTenant(pool, tenantCtx(req), async (tx) => (await tx.query(`${SELECT} order by p.created_at desc`)).rows as Row[]);
    return { prospects: rows.map(present), summary: summarise(rows) };
  });

  app.post('/prospects', { config: { access: 'tenant' } }, async (req, reply) => {
    const actor = requireWorker(req);
    const b = createBody.parse(req.body);
    const id = await withTenant(pool, tenantCtx(req), async (tx) =>
      (
        await tx.query('select prospect_create($1, $2, $3, $4, $5, $6, $7, $8) as id', [
          b.name, b.sector ?? null, b.contactName ?? null, b.source ?? null, b.ownerId ?? actor.userId,
          b.expectedFee === undefined ? null : b.expectedFee.toString(), b.expectedStart ?? null, b.notes ?? null,
        ])
      ).rows[0].id as string,
    );
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string } }>('/prospects/:id', { config: { access: 'tenant' } }, async (req) => {
    requireWorker(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = patchBody.parse(req.body);
    await withTenant(pool, tenantCtx(req), async (tx) => {
      const cur = (await tx.query(`${SELECT} where p.id = $1`, [id.data])).rows[0] as Row | undefined;
      if (!cur) throw httpError(404, 'not_found');
      const merged = {
        name: b.name ?? cur.name,
        sector: b.sector ?? cur.sector,
        contact: b.contactName ?? cur.contact_name,
        source: b.source ?? cur.source,
        cents: b.expectedFee !== undefined ? b.expectedFee.toString() : cur.expected_fee_cents,
        start: b.expectedStart ?? cur.expected_start,
        notes: b.notes ?? cur.notes,
      };
      await tx.query('select prospect_update($1, $2, $3, $4, $5, $6, $7, $8)', [id.data, merged.name, merged.sector, merged.contact, merged.source, merged.cents, merged.start, merged.notes]);
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/prospects/:id/stage', { config: { access: 'tenant' } }, async (req) => {
    requireWorker(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = stageBody.parse(req.body);
    await withTenant(pool, tenantCtx(req), (tx) => tx.query('select prospect_set_stage($1, $2, $3)', [id.data, b.stage, b.reason ?? null]));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/prospects/:id/owner', { config: { access: 'tenant' } }, async (req) => {
    requireWorker(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = ownerBody.parse(req.body);
    if (b.reason.length < 5) throw httpError(400, 'reason_required');
    await withTenant(pool, tenantCtx(req), (tx) => tx.query('select prospect_reassign($1, $2, $3)', [id.data, b.userId, b.reason]));
    return { ok: true };
  });

  /** Won: the prospect becomes a client, once. Opening the engagement is a separate step. */
  app.post<{ Params: { id: string } }>('/prospects/:id/convert', { config: { access: 'tenant' } }, async (req, reply) => {
    assertCan(req, 'client.manage');
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = convertBody.parse(req.body);
    const ctx = tenantCtx(req);
    const clientId = await withTenant(pool, ctx, async (tx) => {
      const p = (await tx.query('select name, sector, stage, client_id from prospects where id = $1', [id.data])).rows[0] as
        | { name: string; sector: string | null; stage: string; client_id: string | null }
        | undefined;
      // No row lock here: prospect_mark_won locks and refuses a second conversion, which rolls this whole transaction back.
      if (!p) throw httpError(404, 'not_found');
      if (p.stage === 'won' || p.stage === 'lost' || p.client_id) throw httpError(409, 'prospect_closed');
      const sector = b.sector ?? p.sector;
      if (!sector) throw httpError(400, 'sector_required');
      const manager = b.accountManagerId ?? ctx.userId;
      if (!(await tx.query('select client_manager_valid($1) as ok', [manager])).rows[0].ok) throw httpError(400, 'invalid_account_manager');
      const cid = randomUUID();
      await tx.query(
        'insert into clients (id, tenant_id, name, sector, legal_form, framework, year_end_month, created_by, account_manager_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [cid, ctx.tenantId, p.name, sector, b.legalForm, b.framework, b.yearEndMonth, ctx.userId, manager],
      );
      await tx.query('select prospect_mark_won($1, $2)', [id.data, cid]);
      return cid;
    });
    return reply.code(201).send({ clientId });
  });
}
