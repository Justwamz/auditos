import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { formatMoney, parseMoney } from '@auditos/fs-engine';
import { withTenant } from '@auditos/db';
import { actorOf, httpError, tenantCtx } from '../authz';
import { loadEngagement } from '../engagements/service';
import { canSeeBilling } from './settings';

const uuid = z.string().uuid();
const MAX_RANGE_DAYS = 93;
const CATEGORIES = ['fuel', 'transport', 'accommodation', 'meals', 'stationery', 'communication', 'other'] as const;

/** A calendar date that really exists, as YYYY-MM-DD. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'not a real date');

const range = z
  .object({ from: day, to: day, userId: uuid.optional(), engagementId: uuid.optional() })
  .refine((q) => q.to >= q.from, { message: 'to must not be before from', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= MAX_RANGE_DAYS, { message: `ask for at most ${MAX_RANGE_DAYS} days`, path: ['to'] });

const timeBody = z
  .object({
    engagementId: uuid.optional(),
    workDate: day,
    minutes: z.number().int().min(1).max(1440),
    description: z.string().trim().min(1).max(500),
    billable: z.boolean().optional(),
  })
  .refine((b) => b.engagementId !== undefined || b.billable !== true, { message: 'time with no engagement is internal and cannot be billable', path: ['billable'] });
const timePatch = z.object({ workDate: day.optional(), minutes: z.number().int().min(1).max(1440).optional(), description: z.string().trim().min(1).max(500).optional(), billable: z.boolean().optional() });

const money = z
  .string()
  .trim()
  .max(20)
  .transform((s, ctx) => {
    try {
      const cents = parseMoney(s);
      if (cents <= 0n) throw new Error('not positive');
      return cents;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'enter an amount above zero in KES, for example 5000.00' });
      return z.NEVER;
    }
  });
const expenseBody = z.object({
  engagementId: uuid,
  spentOn: day,
  category: z.enum(CATEGORIES),
  description: z.string().trim().min(1).max(300),
  amount: money,
  rebillable: z.boolean().default(true),
  receiptItemId: uuid.optional(),
});
const expensePatch = z.object({
  spentOn: day.optional(), category: z.enum(CATEGORIES).optional(), description: z.string().trim().min(1).max(300).optional(),
  amount: money.optional(), rebillable: z.boolean().optional(), receiptItemId: uuid.nullable().optional(),
});

/** Minutes at an hourly rate in cents, rounded half up to the cent. */
export const timeValue = (minutes: number, rateCents: bigint): bigint => (BigInt(minutes) * rateCents * 2n + 60n) / 120n;

export async function timeRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  const requireWorker = (req: Parameters<typeof actorOf>[0]) => {
    if (actorOf(req).role === 'firm_admin') throw httpError(403, 'forbidden');
  };

  app.get('/time', { config: { access: 'tenant' } }, async (req) => {
    requireWorker(req);
    const q = range.parse(req.query);
    const seeRates = canSeeBilling(req);
    const params: unknown[] = [q.from, q.to];
    let more = '';
    if (q.userId) { params.push(q.userId); more += ` and t.user_id = $${params.length}`; }
    if (q.engagementId) { params.push(q.engagementId); more += ` and t.engagement_id = $${params.length}`; }
    const rows = await withTenant(pool, tenantCtx(req), async (tx) =>
      (
        await tx.query(
          `select t.id, t.user_id, coalesce(u.full_name, u.email) as user_name, t.engagement_id, c.name as client_name, to_char(t.work_date, 'YYYY-MM-DD') as work_date,
                  t.minutes, t.description, t.billable, t.rate_cents::text as rate, t.invoice_id is not null as invoiced
             from time_entries t
             join users u on u.id = t.user_id
             left join engagements e on e.id = t.engagement_id
             left join clients c on c.id = e.client_id
            where t.work_date between $1::date and $2::date ${more}
            order by t.work_date desc, t.created_at desc`,
          params,
        )
      ).rows,
    );
    let minutes = 0;
    let billable = 0;
    let value = 0n;
    const entries = rows.map((r) => {
      minutes += r.minutes as number;
      if (r.billable) {
        billable += r.minutes as number;
        value += timeValue(r.minutes, BigInt(r.rate));
      }
      return {
        id: r.id as string, userId: r.user_id as string, userName: r.user_name as string, engagementId: r.engagement_id as string | null,
        engagementName: r.client_name as string | null, workDate: r.work_date as string, minutes: r.minutes as number, description: r.description as string,
        billable: r.billable as boolean, invoiced: r.invoiced as boolean,
        ...(seeRates ? { rate: formatMoney(BigInt(r.rate)), value: formatMoney(r.billable ? timeValue(r.minutes, BigInt(r.rate)) : 0n) } : {}),
      };
    });
    return { entries, totals: { minutes, billableMinutes: billable, ...(seeRates ? { value: formatMoney(value) } : {}) } };
  });

  app.post('/time', { config: { access: 'tenant' } }, async (req, reply) => {
    requireWorker(req);
    const b = timeBody.parse(req.body);
    const ctx = tenantCtx(req);
    const id = await withTenant(pool, ctx, async (tx) => {
      if (b.engagementId && !(await loadEngagement(tx, b.engagementId))) throw httpError(404, 'not_found');
      return (
        await tx.query(
          'insert into time_entries (tenant_id, engagement_id, work_date, minutes, description, billable) values ($1, $2, $3, $4, $5, $6) returning id',
          [ctx.tenantId, b.engagementId ?? null, b.workDate, b.minutes, b.description, b.billable ?? b.engagementId !== undefined],
        )
      ).rows[0].id as string;
    });
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string } }>('/time/:id', { config: { access: 'tenant' } }, async (req) => {
    requireWorker(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = timePatch.parse(req.body);
    await withTenant(pool, tenantCtx(req), async (tx) => {
      const r = await tx.query(
        'update time_entries set work_date = coalesce($2, work_date), minutes = coalesce($3, minutes), description = coalesce($4, description), billable = coalesce($5, billable) where id = $1',
        [id.data, b.workDate ?? null, b.minutes ?? null, b.description ?? null, b.billable ?? null],
      );
      if (r.rowCount === 0) throw httpError(404, 'not_found');
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/time/:id', { config: { access: 'tenant' } }, async (req) => {
    requireWorker(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    await withTenant(pool, tenantCtx(req), async (tx) => {
      const r = await tx.query('delete from time_entries where id = $1', [id.data]);
      if (r.rowCount === 0) throw httpError(404, 'not_found');
    });
    return { ok: true };
  });

  app.get('/expenses', { config: { access: 'tenant' } }, async (req) => {
    requireWorker(req);
    const q = range.parse(req.query);
    const params: unknown[] = [q.from, q.to];
    let more = '';
    if (q.userId) { params.push(q.userId); more += ` and x.user_id = $${params.length}`; }
    if (q.engagementId) { params.push(q.engagementId); more += ` and x.engagement_id = $${params.length}`; }
    const rows = await withTenant(pool, tenantCtx(req), async (tx) =>
      (
        await tx.query(
          `select x.id, x.engagement_id, c.name as client_name, x.user_id, coalesce(u.full_name, u.email) as user_name, to_char(x.spent_on, 'YYYY-MM-DD') as spent_on,
                  x.category, x.description, x.amount_cents::text as amount, x.rebillable, x.receipt_item_id, x.invoice_id is not null as invoiced
             from engagement_expenses x
             join users u on u.id = x.user_id
             left join engagements e on e.id = x.engagement_id
             left join clients c on c.id = e.client_id
            where x.spent_on between $1::date and $2::date ${more}
            order by x.spent_on desc, x.created_at desc`,
          params,
        )
      ).rows,
    );
    return {
      expenses: rows.map((r) => ({
        id: r.id as string, engagementId: r.engagement_id as string, engagementName: r.client_name as string | null, userId: r.user_id as string, userName: r.user_name as string,
        spentOn: r.spent_on as string, category: r.category as string, description: r.description as string, amount: formatMoney(BigInt(r.amount)),
        rebillable: r.rebillable as boolean, receiptItemId: r.receipt_item_id as string | null, invoiced: r.invoiced as boolean,
      })),
    };
  });

  app.post('/expenses', { config: { access: 'tenant' } }, async (req, reply) => {
    requireWorker(req);
    const b = expenseBody.parse(req.body);
    const ctx = tenantCtx(req);
    const id = await withTenant(pool, ctx, async (tx) => {
      if (!(await loadEngagement(tx, b.engagementId))) throw httpError(404, 'not_found');
      return (
        await tx.query(
          'insert into engagement_expenses (tenant_id, engagement_id, spent_on, category, description, amount_cents, rebillable, receipt_item_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
          [ctx.tenantId, b.engagementId, b.spentOn, b.category, b.description, b.amount.toString(), b.rebillable, b.receiptItemId ?? null],
        )
      ).rows[0].id as string;
    });
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string } }>('/expenses/:id', { config: { access: 'tenant' } }, async (req) => {
    requireWorker(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = expensePatch.parse(req.body);
    await withTenant(pool, tenantCtx(req), async (tx) => {
      const r = await tx.query(
        `update engagement_expenses set spent_on = coalesce($2, spent_on), category = coalesce($3, category), description = coalesce($4, description),
                amount_cents = coalesce($5, amount_cents), rebillable = coalesce($6, rebillable),
                receipt_item_id = case when $7::boolean then $8::uuid else receipt_item_id end where id = $1`,
        [id.data, b.spentOn ?? null, b.category ?? null, b.description ?? null, b.amount === undefined ? null : b.amount.toString(), b.rebillable ?? null, b.receiptItemId !== undefined, b.receiptItemId ?? null],
      );
      if (r.rowCount === 0) throw httpError(404, 'not_found');
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/expenses/:id', { config: { access: 'tenant' } }, async (req) => {
    requireWorker(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    await withTenant(pool, tenantCtx(req), async (tx) => {
      const r = await tx.query('delete from engagement_expenses where id = $1', [id.data]);
      if (r.rowCount === 0) throw httpError(404, 'not_found');
    });
    return { ok: true };
  });
}
