import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { formatMoney, parseMoney } from '@auditos/fs-engine';
import { withTenant } from '@auditos/db';
import { actorOf, httpError, tenantCtx } from '../authz';
import { loadEngagement } from '../engagements/service';

const uuid = z.string().uuid();
export const RATE_ROLES = ['partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'] as const;

/** Partners, managers and holders of the administrator permission may read billing information. */
export function canSeeBilling(req: FastifyRequest): boolean {
  const a = actorOf(req);
  return a.role === 'partner' || a.role === 'manager' || a.role === 'firm_admin' || a.isAdmin === true;
}
/** Partners and holders of the administrator permission set the firm-wide billing information. */
export function canManageBilling(req: FastifyRequest): boolean {
  const a = actorOf(req);
  return a.role === 'partner' || a.role === 'firm_admin' || a.isAdmin === true;
}

const money = z
  .string()
  .trim()
  .max(20)
  .transform((s, ctx) => {
    try {
      const cents = parseMoney(s);
      if (cents < 0n) throw new Error('negative');
      return cents;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'enter an amount in KES, for example 1500.00' });
      return z.NEVER;
    }
  });

/** A percentage such as "16" or "16.5" with at most two decimals, as hundredths of a percent. */
const percent = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/)
  .transform((s, ctx) => {
    const [whole, frac = ''] = s.split('.');
    const bp = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
    if (bp > 10_000) {
      ctx.addIssue({ code: 'custom', message: 'a tax rate cannot be above 100%' });
      return z.NEVER;
    }
    return bp;
  });

const settingsBody = z
  .object({
    legalName: z.string().trim().max(200).optional(),
    address: z.string().trim().max(500).optional(),
    kraPin: z.string().trim().toUpperCase().regex(/^[AP]\d{9}[A-Z]$/).optional(),
    bankDetails: z.string().trim().max(500).optional(),
    invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/).optional(),
    quotePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/).optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
  })
  .strict();
const ratesBody = z.object({ rates: z.partialRecord(z.enum(RATE_ROLES), money).refine((r) => Object.keys(r).length > 0, 'no rates given') });
const taxBody = z.object({ name: z.string().trim().min(1).max(60), rate: percent, onPrevious: z.boolean().default(false) });
const taxPatch = z.object({ name: z.string().trim().min(1).max(60).optional(), rate: percent.optional(), onPrevious: z.boolean().optional(), active: z.boolean().optional() });
const feeBody = z
  .object({ basis: z.enum(['hourly', 'flat']), flatFee: money.optional(), budgetHours: z.number().min(0).max(100_000).optional(), notes: z.string().trim().max(1000).optional() })
  .refine((b) => b.basis !== 'flat' || b.flatFee !== undefined, { message: 'a flat fee needs an amount', path: ['flatFee'] });

const DEFAULTS = { legalName: null, address: null, kraPin: null, bankDetails: null, invoicePrefix: 'INV', quotePrefix: 'QUO', paymentTermsDays: 30 };

export async function billingSettingsRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  app.get('/billing/settings', { config: { access: 'tenant' } }, async (req) => {
    if (!canSeeBilling(req)) throw httpError(403, 'forbidden');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const s = (await tx.query('select legal_name, address, kra_pin, bank_details, invoice_prefix, quote_prefix, payment_terms_days from billing_settings')).rows[0];
      const rates = (await tx.query('select role, rate_cents::text as cents from billing_rates')).rows as { role: string; cents: string }[];
      const taxes = (await tx.query('select id, name, rate_bp, on_previous, active from tax_rates order by name')).rows;
      return {
        settings: s
          ? { legalName: s.legal_name, address: s.address, kraPin: s.kra_pin, bankDetails: s.bank_details, invoicePrefix: s.invoice_prefix, quotePrefix: s.quote_prefix, paymentTermsDays: s.payment_terms_days }
          : DEFAULTS,
        rates: RATE_ROLES.flatMap((role) => rates.filter((r) => r.role === role).map((r) => ({ role, rate: formatMoney(BigInt(r.cents)) }))),
        taxes: taxes.map((t) => ({ id: t.id as string, name: t.name as string, rate: (t.rate_bp / 100).toFixed(2), onPrevious: t.on_previous as boolean, active: t.active as boolean })),
      };
    });
  });

  app.put('/billing/settings', { config: { access: 'tenant' } }, async (req) => {
    if (!canManageBilling(req)) throw httpError(403, 'forbidden');
    const b = settingsBody.parse(req.body);
    const ctx = tenantCtx(req);
    await withTenant(pool, ctx, async (tx) => {
      const cur = (await tx.query('select legal_name, address, kra_pin, bank_details, invoice_prefix, quote_prefix, payment_terms_days from billing_settings')).rows[0];
      const next = {
        legal_name: b.legalName ?? cur?.legal_name ?? null,
        address: b.address ?? cur?.address ?? null,
        kra_pin: b.kraPin ?? cur?.kra_pin ?? null,
        bank_details: b.bankDetails ?? cur?.bank_details ?? null,
        invoice_prefix: b.invoicePrefix ?? cur?.invoice_prefix ?? 'INV',
        quote_prefix: b.quotePrefix ?? cur?.quote_prefix ?? 'QUO',
        payment_terms_days: b.paymentTermsDays ?? cur?.payment_terms_days ?? 30,
      };
      await tx.query(
        `insert into billing_settings (tenant_id, legal_name, address, kra_pin, bank_details, invoice_prefix, quote_prefix, payment_terms_days)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (tenant_id) do update set legal_name = excluded.legal_name, address = excluded.address, kra_pin = excluded.kra_pin,
           bank_details = excluded.bank_details, invoice_prefix = excluded.invoice_prefix, quote_prefix = excluded.quote_prefix,
           payment_terms_days = excluded.payment_terms_days, updated_at = now()`,
        [ctx.tenantId, next.legal_name, next.address, next.kra_pin, next.bank_details, next.invoice_prefix, next.quote_prefix, next.payment_terms_days],
      );
    });
    return { ok: true };
  });

  app.put('/billing/rates', { config: { access: 'tenant' } }, async (req) => {
    if (!canManageBilling(req)) throw httpError(403, 'forbidden');
    const b = ratesBody.parse(req.body);
    const ctx = tenantCtx(req);
    await withTenant(pool, ctx, async (tx) => {
      for (const [role, cents] of Object.entries(b.rates)) {
        await tx.query(
          'insert into billing_rates (tenant_id, role, rate_cents) values ($1, $2, $3) on conflict (tenant_id, role) do update set rate_cents = excluded.rate_cents, updated_at = now()',
          [ctx.tenantId, role, cents.toString()],
        );
      }
    });
    return { ok: true };
  });

  app.post('/billing/taxes', { config: { access: 'tenant' } }, async (req, reply) => {
    if (!canManageBilling(req)) throw httpError(403, 'forbidden');
    const b = taxBody.parse(req.body);
    const ctx = tenantCtx(req);
    try {
      const id = await withTenant(pool, ctx, async (tx) =>
        (await tx.query('insert into tax_rates (tenant_id, name, rate_bp, on_previous) values ($1, $2, $3, $4) returning id', [ctx.tenantId, b.name, b.rate, b.onPrevious])).rows[0].id as string,
      );
      return reply.code(201).send({ id });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw httpError(409, 'duplicate');
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>('/billing/taxes/:id', { config: { access: 'tenant' } }, async (req) => {
    if (!canManageBilling(req)) throw httpError(403, 'forbidden');
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = taxPatch.parse(req.body);
    await withTenant(pool, tenantCtx(req), async (tx) => {
      const r = await tx.query(
        'update tax_rates set name = coalesce($2, name), rate_bp = coalesce($3, rate_bp), on_previous = coalesce($4, on_previous), active = coalesce($5, active) where id = $1',
        [id.data, b.name ?? null, b.rate ?? null, b.onPrevious ?? null, b.active ?? null],
      );
      if (r.rowCount === 0) throw httpError(404, 'not_found');
    });
    return { ok: true };
  });

  /** The fee arrangement for one engagement: hourly with a budget, or a flat fee. */
  app.get<{ Params: { id: string } }>('/engagements/:id/fee', { config: { access: 'tenant' } }, async (req) => {
    if (!canSeeBilling(req)) throw httpError(403, 'forbidden');
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, id.data))) throw httpError(404, 'not_found');
      const f = (await tx.query('select basis, flat_fee_cents::text as flat, budget_hours::float8 as hours, notes from engagement_fees where engagement_id = $1', [id.data])).rows[0];
      return { fee: f ? { basis: f.basis as string, flatFee: f.flat === null ? null : formatMoney(BigInt(f.flat)), budgetHours: f.hours as number | null, notes: f.notes as string | null } : null };
    });
  });

  app.put<{ Params: { id: string } }>('/engagements/:id/fee', { config: { access: 'tenant' } }, async (req) => {
    const a = actorOf(req);
    if (a.role !== 'manager' && a.role !== 'partner') throw httpError(403, 'forbidden');
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = feeBody.parse(req.body);
    const ctx = tenantCtx(req);
    await withTenant(pool, ctx, async (tx) => {
      if (!(await loadEngagement(tx, id.data))) throw httpError(404, 'not_found');
      await tx.query(
        `insert into engagement_fees (engagement_id, tenant_id, basis, flat_fee_cents, budget_hours, notes) values ($1, $2, $3, $4, $5, $6)
         on conflict (engagement_id) do update set basis = excluded.basis, flat_fee_cents = excluded.flat_fee_cents, budget_hours = excluded.budget_hours, notes = excluded.notes, updated_at = now()`,
        [id.data, ctx.tenantId, b.basis, b.basis === 'flat' ? b.flatFee!.toString() : null, b.budgetHours ?? null, b.notes ?? null],
      );
    });
    return { ok: true };
  });
}
