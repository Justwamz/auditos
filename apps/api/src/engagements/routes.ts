import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@auditos/db';
import { assertCan, httpError, requireFreshStepUp, tenantCtx } from '../authz';
import { recordView } from '../audit/views';
import { evaluateGates } from './gates';
import { ENGAGEMENT_STATES, listEngagements, loadEngagement, nextState, type EngagementRow, type EngagementState } from './service';

const SECTORS = ['trading', 'consultancy', 'rental', 'farming', 'pension', 'investment'] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date');
const uuid = z.string().uuid();

const clientBody = z.object({
  name: z.string().trim().min(1).max(200),
  sector: z.enum(SECTORS),
  legalForm: z.string().trim().min(1).max(60),
  framework: z.enum(['IFRS_SME', 'FULL_IFRS']).default('IFRS_SME'),
  yearEndMonth: z.number().int().min(1).max(12),
  accountManagerId: uuid.optional(),
});
const engagementBody = z
  .object({
    clientId: uuid,
    periodStart: date,
    periodEnd: date,
    partnerId: uuid,
    riskFlags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })
  .refine((b) => b.periodEnd > b.periodStart, { message: 'periodEnd must be after periodStart', path: ['periodEnd'] });
const memberBody = z.object({ userId: uuid });
const transitionBody = z.object({ to: z.enum(ENGAGEMENT_STATES), reportDate: date.optional() });
const declarationBody = z.object({
  engagementId: uuid.optional(),
  statement: z.string().trim().min(10).max(2000),
  threats: z.array(z.object({ threat: z.string().max(200), safeguard: z.string().max(500) })).max(20).default([]),
});

function present(e: EngagementRow) {
  return {
    id: e.id,
    clientId: e.client_id,
    clientName: e.client_name,
    sector: e.sector,
    framework: e.framework,
    periodStart: e.period_start,
    periodEnd: e.period_end,
    state: e.state,
    partnerId: e.partner_id,
    eqrId: e.eqr_id,
    reportDate: e.report_date,
    lockedAt: e.locked_at,
    riskFlags: e.risk_profile.riskFlags ?? [],
  };
}

export async function engagementRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  app.post('/independence', { config: { access: 'tenant' } }, async (req, reply) => {
    const body = declarationBody.parse(req.body);
    const ctx = tenantCtx(req);
    const id = await withTenant(pool, ctx, async (tx) =>
      (
        await tx.query(
          'insert into independence_declarations (tenant_id, user_id, engagement_id, statement, threats) values ($1, $2, $3, $4, $5) returning id',
          [ctx.tenantId, ctx.userId, body.engagementId ?? null, body.statement, JSON.stringify(body.threats)],
        )
      ).rows[0].id as string,
    ).catch((e: { code?: string }) => {
      if (e.code === '23503') throw httpError(404, 'not_found');
      throw e;
    });
    return reply.code(201).send({ id });
  });

  app.post('/clients', { config: { access: 'tenant' } }, async (req, reply) => {
    assertCan(req, 'client.manage');
    const b = clientBody.parse(req.body);
    const ctx = tenantCtx(req);
    const id = randomUUID();
    const manager = b.accountManagerId ?? ctx.userId;
    await withTenant(pool, ctx, async (tx) => {
      if (!(await tx.query('select client_manager_valid($1) as ok', [manager])).rows[0].ok) throw httpError(400, 'invalid_account_manager');
      // No RETURNING: the new client may belong to a colleague, whom the creator then cannot read back.
      await tx.query(
        'insert into clients (id, tenant_id, name, sector, legal_form, framework, year_end_month, created_by, account_manager_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [id, ctx.tenantId, b.name, b.sector, b.legalForm, b.framework, b.yearEndMonth, ctx.userId, manager],
      );
    });
    return reply.code(201).send({ id });
  });

  app.get('/clients', { config: { access: 'tenant' } }, async (req) => {
    const rows = await withTenant(pool, tenantCtx(req), async (tx) =>
      (
        await tx.query(
          `select c.id, c.name, c.sector, c.legal_form, c.framework, c.year_end_month, c.account_manager_id, coalesce(u.full_name, u.email) as account_manager_name
             from clients c left join users u on u.id = c.account_manager_id order by c.name`,
        )
      ).rows,
    );
    return {
      clients: rows.map((r) => ({
        id: r.id, name: r.name, sector: r.sector, legalForm: r.legal_form, framework: r.framework, yearEndMonth: r.year_end_month,
        accountManagerId: r.account_manager_id as string | null, accountManagerName: r.account_manager_name as string | null,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/clients/:id', { config: { access: 'tenant' } }, async (req) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const c = (
        await tx.query(
          `select c.id, c.name, c.sector, c.legal_form, c.framework, c.year_end_month, c.account_manager_id, coalesce(u.full_name, u.email) as account_manager_name
             from clients c left join users u on u.id = c.account_manager_id where c.id = $1`,
          [id.data],
        )
      ).rows[0];
      if (!c) throw httpError(404, 'not_found');
      await recordView(req, tx, { type: 'client', id: c.id, label: c.name });
      const engagements = (await listEngagements(tx)).filter((e) => e.client_id === id.data).map(present);
      return {
        id: c.id, name: c.name, sector: c.sector, legalForm: c.legal_form, framework: c.framework, yearEndMonth: c.year_end_month,
        accountManagerId: c.account_manager_id as string | null, accountManagerName: c.account_manager_name as string | null,
        engagements,
      };
    });
  });

  app.post('/engagements', { config: { access: 'tenant' } }, async (req, reply) => {
    assertCan(req, 'engagement.create');
    const b = engagementBody.parse(req.body);
    const id = await withTenant(pool, tenantCtx(req), async (tx) =>
      (
        await tx.query('select engagement_create($1, $2, $3, $4, $5) as id', [
          b.clientId, b.periodStart, b.periodEnd, b.partnerId, JSON.stringify({ riskFlags: b.riskFlags }),
        ])
      ).rows[0].id as string,
    );
    return reply.code(201).send({ id });
  });

  app.get('/engagements', { config: { access: 'tenant' } }, async (req) => {
    const rows = await withTenant(pool, tenantCtx(req), listEngagements);
    return { engagements: rows.map(present) };
  });

  app.get<{ Params: { id: string } }>('/engagements/:id', { config: { access: 'tenant' } }, async (req) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const e = await withTenant(pool, tenantCtx(req), async (tx) => {
      const found = await loadEngagement(tx, id.data);
      if (found) await recordView(req, tx, { type: 'engagement', id: found.id, label: found.client_name, engagementId: found.id });
      return found;
    });
    if (!e) throw httpError(404, 'not_found');
    assertCan(req, 'engagement.read', { assigned: true });
    return present(e);
  });

  app.post<{ Params: { id: string } }>('/engagements/:id/members', { config: { access: 'tenant' } }, async (req, reply) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const { userId } = memberBody.parse(req.body);
    const e = await withTenant(pool, tenantCtx(req), (tx) => loadEngagement(tx, id.data));
    if (!e) throw httpError(404, 'not_found');
    assertCan(req, 'engagement.assign', { assigned: true });
    await withTenant(pool, tenantCtx(req), (tx) => tx.query('select engagement_add_member($1, $2)', [id.data, userId]));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/engagements/:id/eqr', { config: { access: 'tenant' } }, async (req) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const { userId } = memberBody.parse(req.body);
    const e = await withTenant(pool, tenantCtx(req), (tx) => loadEngagement(tx, id.data));
    if (!e) throw httpError(404, 'not_found');
    assertCan(req, 'engagement.assign_eqr', { assigned: true, engagementPartnerId: e.partner_id, eqrId: userId });
    await withTenant(pool, tenantCtx(req), (tx) => tx.query('select engagement_set_eqr($1, $2)', [id.data, userId]));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/engagements/:id/transition', { config: { access: 'tenant' } }, async (req, reply) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const body = transitionBody.parse(req.body);
    const result = await withTenant(pool, tenantCtx(req), async (tx) => {
      const e = await loadEngagement(tx, id.data);
      if (!e) throw httpError(404, 'not_found');
      const actor = assertCan(req, 'engagement.transition', { assigned: true });
      const to = body.to as EngagementState;
      if (nextState(e.state) !== to) throw httpError(409, 'invalid_transition');
      if (to === 'partner_approved' || to === 'report_issued' || to === 'locked') {
        if (actor.role !== 'partner' || actor.userId !== e.partner_id) throw httpError(403, 'partner_required');
        requireFreshStepUp(req);
      }
      if (to === 'report_issued' && !body.reportDate) throw httpError(400, 'report_date_required');
      const blockers = await evaluateGates(tx, id.data, e.state, to);
      if (blockers.length > 0) return { blockers };
      await tx.query('select engagement_transition($1, $2, $3)', [id.data, to, body.reportDate ?? null]);
      return { state: to };
    });
    if ('blockers' in result) return reply.code(409).send({ error: 'gate_blocked', blockers: result.blockers });
    return result;
  });
}
